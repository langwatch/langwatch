"""A tiny stand-in for a customer system that a code agent logs in to.

It exists to answer one question the product cannot answer about itself: do the
rows of a run arrive holding the SAME session, or does each row log in again?
So it counts logins, refuses a session it did not issue, and records which
session every request carried.

Pair it with seed-agent-cache-shared-session.ts, which points the project's
ACME_* secrets at it:

    ACME_USERNAME=acme-robot ACME_PASSWORD=p4ssw0rd-dogfood \
      python3 scripts/dogfood/acme-stub-server.py

    PROJECT_SLUG=<slug> ACME_BASE=http://127.0.0.1:5599 \
      npx tsx --import ./src/env-load.ts \
      scripts/dogfood/seed-agent-cache-shared-session.ts

Then run the experiment and read `GET /_stats`. One login for a whole dataset,
and every row on one session, is the cache working. A login per row is not.

Routes:
    POST /login        {"username","password"} -> {"session": "..."}  (counts)
    POST /chat, /work  Authorization: Bearer <session> -> {"reply": "..."}
    GET  /_stats       what happened so far
    POST /_reset       forget every session, the way a restart does

`_reset` is also how to reach the refused-session path: the entry the cache
holds stays live while the target no longer knows it.
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

USERNAME = os.environ.get("ACME_USERNAME", "acme-agent")
PASSWORD = os.environ.get("ACME_PASSWORD", "hunter2")
# How long an issued session stays valid. Short values prove the refresh path.
SESSION_TTL_SECONDS = float(os.environ.get("ACME_SESSION_TTL_SECONDS", "900"))
# Slow the login down, so a parallel wave has a real window to overlap in.
LOGIN_DELAY_SECONDS = float(os.environ.get("ACME_LOGIN_DELAY_SECONDS", "0"))

lock = threading.Lock()
state = {
    "logins": 0,
    "works": 0,
    "rejected": 0,
    # session -> issued_at
    "issued": {},
    # session -> how many work calls arrived with it
    "used": {},
    "log": [],
}


def note(line):
    stamp = time.strftime("%H:%M:%S")
    state["log"].append(f"{stamp} {line}")
    print(f"{stamp} {line}", flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass  # the notes below are the log

    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_POST(self):
        if self.path == "/login":
            return self._login()
        if self.path in ("/work", "/chat"):
            return self._work()
        if self.path == "/_reset":
            return self._reset()
        self._send(404, {"error": "no such route"})

    def do_GET(self):
        if self.path == "/_stats":
            return self._stats()
        self._send(404, {"error": "no such route"})

    def _login(self):
        body = self._body()
        if body.get("username") != USERNAME or body.get("password") != PASSWORD:
            with lock:
                state["rejected"] += 1
                note(f"login REFUSED for {body.get('username')!r}")
            return self._send(401, {"error": "bad credentials"})

        if LOGIN_DELAY_SECONDS:
            time.sleep(LOGIN_DELAY_SECONDS)

        with lock:
            state["logins"] += 1
            session = f"sess-{state['logins']:02d}-{int(time.time() * 1000) % 100000}"
            state["issued"][session] = time.time()
            note(f"LOGIN #{state['logins']} -> {session}")
        self._send(200, {"session": session})

    def _work(self):
        header = self.headers.get("Authorization") or ""
        session = header[7:] if header.startswith("Bearer ") else ""
        body = self._body()

        with lock:
            issued_at = state["issued"].get(session)
            if issued_at is None:
                state["rejected"] += 1
                note(f"work REFUSED, session not issued here: {session!r}")
                return self._send(401, {"error": "unknown session"})
            if time.time() - issued_at > SESSION_TTL_SECONDS:
                state["rejected"] += 1
                note(f"work REFUSED, session expired: {session}")
                return self._send(401, {"error": "session expired"})
            state["works"] += 1
            state["used"][session] = state["used"].get(session, 0) + 1
            note(f"work #{state['works']} with {session} :: {body.get('message')!r}")

        self._send(200, {"reply": f"handled {body.get('message')!r} as {USERNAME}"})

    def _stats(self):
        with lock:
            self._send(
                200,
                {
                    "logins": state["logins"],
                    "works": state["works"],
                    "rejected": state["rejected"],
                    "distinct_sessions_used": len(state["used"]),
                    "used": state["used"],
                    "log": state["log"],
                },
            )

    def _reset(self):
        with lock:
            state.update(
                {
                    "logins": 0,
                    "works": 0,
                    "rejected": 0,
                    "issued": {},
                    "used": {},
                    "log": [],
                }
            )
        self._send(200, {"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("ACME_PORT", "5599"))
    note(f"ACME stub listening on 127.0.0.1:{port}, session ttl {SESSION_TTL_SECONDS}s")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
