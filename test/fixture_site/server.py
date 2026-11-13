#!/usr/bin/env python3
"""A tiny, dependency-free web site that ``fetch_opengraph`` is tested against.

The suite stays deterministic and offline: every page the tests fetch comes
from here.

Routes
------
``/<name>.html``  a file from ``test/fixtures/`` (``text/html; charset=utf-8``)
``/latin1``       a windows-1252 page whose only charset is ``<meta charset>``
``/redirect``     302 to ``/article.html``
``/missing``      404
``/image.png``    a non-HTML response (``image/png``)
``/flaky``        429 with ``Retry-After: 0`` on the first request, then a page
``/slow``         waits 3 s before answering (for timeout tests)
``/big``          a small ``<head>`` followed by an endless body (tests that
                  reading stops at ``</head>``)
``/health``       ``ok``

Usage::

    python3 test/fixture_site/server.py            # prints PORT:<n> once listening
"""

from __future__ import annotations

import argparse
import contextlib
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

_flaky_seen = False
_flaky_lock = threading.Lock()

LATIN1 = (
    b'<html><head><meta charset="windows-1252"><meta property="og:title" content="Caf\xe9 \x93Ole\x94">'
    b"</head></html>"
)


class Handler(BaseHTTPRequestHandler):
    """Serve the fixture pages."""

    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - stdlib signature
        """Log to stderr only, so stdout carries nothing except the ``PORT:`` line."""
        sys.stderr.write("fixture_site: " + (format % args) + "\n")

    def _send(self, status: int, body: bytes, content_type: str, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        """Handle GET requests."""
        global _flaky_seen
        path = urlparse(self.path).path
        html = "text/html; charset=utf-8"
        if path == "/health":
            self._send(200, b"ok", "text/plain")
        elif path.endswith(".html") and "/" not in path[1:] and (FIXTURES / path[1:]).is_file():
            self._send(200, (FIXTURES / path[1:]).read_bytes(), html)
        elif path == "/latin1":
            self._send(200, LATIN1, "text/html")
        elif path == "/redirect":
            self._send(302, b"", html, {"Location": "/article.html"})
        elif path == "/image.png":
            self._send(200, b"\x89PNG\r\n\x1a\n", "image/png")
        elif path == "/flaky":
            with _flaky_lock:
                first = not _flaky_seen
                _flaky_seen = True
            if first:
                self._send(429, b"slow down", "text/plain", {"Retry-After": "0"})
            else:
                self._send(200, b'<meta property="og:title" content="Second time lucky">', html)
        elif path == "/slow":
            time.sleep(3)
            self._send(200, b"<title>late</title>", html)
        elif path == "/big":
            self._stream_big()
        else:
            self._send(404, b"not found", "text/plain")

    def _stream_big(self) -> None:
        """A head, then up to 64 MiB of body; the client should hang up early."""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            self.wfile.write(b'<html><head><meta property="og:title" content="Big page"></head><body>')
            filler = b"<p>" + b"x" * 65536 + b"</p>"
            for _ in range(1024):
                self.wfile.write(filler)


def main() -> None:
    """Start the server and print ``PORT:<n>`` once it is listening."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"PORT:{server.server_address[1]}", flush=True)
    with contextlib.suppress(KeyboardInterrupt):
        server.serve_forever()


if __name__ == "__main__":
    main()
