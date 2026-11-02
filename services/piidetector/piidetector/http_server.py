"""Plain HTTP entrypoint for running the detector as an ordinary container.

    python -m piidetector.http_server            (listens on PORT, default 8080)

    POST /detect   body: the request described in service.py   -> 200 with the response
    GET  /healthz  -> 200 {"status": "ok", "components": [...]} once the models are loaded

Requests are handled one at a time: each model call already uses every thread it is given,
so concurrency comes from running more containers, as it does on Lambda.
Standard library only, so the image needs no web framework.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from .service import BadRequest, Detector

MAX_BODY_BYTES = 6 * 1024 * 1024  # the Lambda request payload limit, so both entrypoints accept the same requests


def make_handler(detector):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):  # noqa: N802  (http.server naming)
            if self.path == "/healthz":
                self._send(200, {"status": "ok", "components": detector.components})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path != "/detect":
                self._send(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY_BYTES:
                self._send(413 if length > MAX_BODY_BYTES else 400, {"error": "bad Content-Length"})
                return
            try:
                request = json.loads(self.rfile.read(length) or b"null")
                self._send(200, detector.handle(request))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send(400, {"error": "body is not JSON"})
            except BadRequest as e:
                self._send(400, {"error": str(e)})

        def log_message(self, format, *args):  # noqa: A002
            pass  # the default access log is replaced by the counts-only log in service.py

    return Handler


def main():
    detector = Detector.from_environment()
    server = HTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), make_handler(detector))  # noqa: S104
    server.serve_forever()


if __name__ == "__main__":
    main()
