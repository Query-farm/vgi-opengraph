"""Presentation and a bounded loopback HTTP fixture for OpenGraph notebooks."""

import atexit
import hashlib
import json
import threading
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap
from vgi_notebooks import finish

SOURCE = "Source: authored synthetic inputs · VGI OpenGraph v0.1.0 · no real websites or image requests"
COLORS = {
    "Accepted": "#267358",
    "Needs review": "#c77c3e",
    "Unavailable HTML": "#adb9b1",
}


def verify_fixtures():
    manifest = json.loads(Path("fixtures/provenance.json").read_text())
    for name, expected in manifest["files"].items():
        if (
            hashlib.sha256((Path("fixtures") / name).read_bytes()).hexdigest()
            != expected["sha256"]
        ):
            raise ValueError(f"Fixture differs from its recorded provenance: {name}")
    return hashlib.sha256(Path("fixtures/pages.json").read_bytes()).hexdigest()


def validate_switch(value, name):
    if type(value) is not bool:
        raise ValueError(f"{name} must be True or False.")


class FixtureSite:
    """Serve only six authored local paths; retain every received request."""

    def __init__(self):
        self.responses = json.loads(Path("fixtures/responses.json").read_text())
        self.requests = []
        self.lock = threading.Lock()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                with owner.lock:
                    owner.requests.append(self.path)
                response = owner.responses.get(self.path)
                if response is None:
                    self.send_error(500, "Unexpected fixture path")
                    return
                body = response["body"].encode("utf-8")
                self.send_response(response["status"])
                self.send_header("Content-Type", response["content_type"])
                self.send_header("Content-Length", str(len(body)))
                if "location" in response:
                    self.send_header("Location", response["location"])
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # The worker may cancel response-body reads after headers/head.

            def log_message(self, *_):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.closed = False
        atexit.register(self.close)

    def save_audit(self):
        with self.lock:
            counts = Counter(self.requests)
        expected = {path: 1 for path in self.responses}
        if counts != expected:
            raise AssertionError(f"Unexpected local request counts: {dict(counts)}")
        rows = [
            {"path": path, "requests": count} for path, count in sorted(counts.items())
        ]
        Path("artifacts").mkdir(exist_ok=True)
        Path("artifacts/request-log.json").write_text(json.dumps(rows, indent=2) + "\n")
        return sum(counts.values())

    def close(self):
        if not self.closed:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=5)
            self.closed = True


def availability(fields):
    names = ["title", "description", "image", "page_url"]
    matrix = np.array(
        [
            [int(getattr(r, f)) if r.available else 2 for f in names]
            for r in fields.itertuples()
        ]
    )
    fig, ax = plt.subplots(figsize=(12, 8))
    ax.imshow(
        matrix,
        cmap=ListedColormap(["#f1d4ba", "#b9ddcf", "#e2e6e3"]),
        vmin=0,
        vmax=2,
        aspect="auto",
    )
    for i in range(len(fields)):
        for j in range(4):
            ax.text(
                j,
                i,
                ["Missing", "Present", "Unavailable"][matrix[i, j]],
                ha="center",
                va="center",
                fontsize=10,
            )
    ax.set_xticks(range(4), ["Title", "Description", "Image URL", "Page URL"])
    ax.set_yticks(
        range(len(fields)), [f"{r.page_id} · {r.label}" for r in fields.itertuples()]
    )
    ax.grid(False)
    finish(
        fig,
        "Populated fields do not establish a valid preview",
        "Nine source records stay visible · missing HTML is distinct from absent metadata",
        SOURCE,
        name="01-field-availability",
    )


def policy_counts(outcomes, require_og_title):
    fig, ax = plt.subplots(figsize=(11, 6))
    bars = ax.barh(
        range(len(outcomes)),
        outcomes.pages,
        color=[COLORS[x] for x in outcomes.outcome],
    )
    ax.set_yticks(range(len(outcomes)), outcomes.outcome.tolist())
    ax.invert_yaxis()
    ax.bar_label(bars, fmt="%d", padding=5)
    ax.set_xlim(0, 9)
    ax.set_xticks(range(10))
    ax.set_xlabel("Authored page records · count")
    finish(
        fig,
        "A stricter rule changes selection, not parsing",
        f"Explicit Open Graph title required: {require_og_title} · denominator: nine page records",
        SOURCE,
        name="02-policy-counts",
    )


def fetch_counts(counts, require_direct):
    palette = {
        "Selected preview": "#267358",
        "Redirect needs review": "#c77c3e",
        "No preview title": "#9bab91",
        "Fetch rejected": "#e0b38b",
        "Missing URL": "#adb9b1",
    }
    fig, ax = plt.subplots(figsize=(12, 7))
    bars = ax.barh(
        range(len(counts)),
        counts.input_rows,
        color=[palette[x] for x in counts.outcome],
    )
    ax.set_yticks(range(len(counts)), counts.outcome.tolist())
    ax.invert_yaxis()
    ax.bar_label(bars, fmt="%d", padding=5)
    ax.set_xlim(0, 5)
    ax.set_xticks(range(6))
    ax.set_xlabel("URL input rows · count, including repeated and missing inputs")
    finish(
        fig,
        "HTTP success and usable metadata are separate",
        f"Require direct response: {require_direct} · nine inputs · six observed local HTTP requests",
        SOURCE,
        name="03-fetch-outcomes",
    )
