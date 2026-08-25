# Canonical shared-session code agent: log in once, reuse the session on the
# rows that follow.
#
# The rows of an experiment or a dataset run are isolated on purpose, so each
# row starts cold and a login on every row is the default result. This example
# keeps ONE session in the project's encrypted secret store. The platform reads
# every project secret from the database when it prepares a row, so a row can
# read the session that an earlier row wrote.
#
# It is executed, not only read, by shared_session_example_test.go in the parent
# package, through the same runner.py that runs every code agent in production.
#
# What the store gives you:
#   - The value is encrypted at rest and no API returns it. This is the correct
#     place for a session token. A dataset row is the alternative and it is kept
#     in clear and is readable in the UI, so it suits a fixture and not a
#     credential.
#
# The limit, stated plainly:
#   - The `secrets` namespace a row reads is a snapshot taken when that row
#     starts. A row cannot re-read it later, and it cannot see a write made by a
#     row that runs beside it. So the first parallel wave performs one login per
#     row in the wave, and the rows after the wave reuse the session. No lock
#     can prevent this, because the row that waits still holds the old snapshot.
#     Keep the login idempotent on the target system, or lower the run's
#     parallelism if the target rate-limits the login.
#
# Contract notes (things the sandbox enforces, in the order people trip on them):
#   - Entry point: `class Code` with `__call__`. No constructor arguments.
#   - `secrets` is a namespace injected into the module globals by runner.py.
#     It is NOT the stdlib `secrets` module. Do not `import secrets`, that would
#     shadow the injected namespace.
#   - `os.environ` is NOT populated with project secrets in the sandbox.
#   - Every declared output key must be returned, or the run fails with
#     KeyError("missing_output: ...").
#   - Only `requests`, `httpx`, `pydantic` and `langwatch` are installed.
#   - The whole call must fit the runner's wall-clock budget (60s by default).

import json
import sys
import time

import requests

# --- Tune these three -------------------------------------------------------
# The project secret that holds the session. Key it on something stable: the
# target host, or a fixed name when the agent talks to one system.
SESSION_SECRET_NAME = "ACME_SESSION"
# How long the target system says a session is good for. Set it to a few
# seconds while you test the refresh path, and to the real value when you share
# the agent.
SESSION_TTL_SECONDS = 15 * 60
# Refresh this long before the end, so a long row cannot expire mid-call. Keep
# it larger than the slowest row.
REFRESH_MARGIN_SECONDS = 60
# ----------------------------------------------------------------------------

LOGIN_TIMEOUT_SECONDS = 10
API_TIMEOUT_SECONDS = 30
STORE_TIMEOUT_SECONDS = 10


class Code:
    def __call__(self, message: str):
        session = get_session()

        response = requests.post(
            required_secret("ACME_API_URL"),
            json={"message": message},
            headers={"Authorization": f"Bearer {session}"},
            timeout=API_TIMEOUT_SECONDS,
        )
        # raise_for_status puts the URL and the status code in the error, never
        # the request body or the session, so a rejected session fails clearly.
        response.raise_for_status()

        return {"output": response.json()["reply"]}


def get_session():
    """Return a session token. This is the one line each row calls."""
    cached = read_cached_session()
    if cached is not None:
        return cached

    session = login()
    store_session(session)
    return session


def read_cached_session():
    """Return the stored session while it is still fresh, else None."""
    raw = optional_secret(SESSION_SECRET_NAME)
    if raw is None:
        return None

    try:
        entry = json.loads(raw)
        issued_at = float(entry["issued_at"])
        session = entry["session"]
    except (ValueError, KeyError, TypeError):
        # Written by hand, or by an older version of this agent. Treat it as a
        # miss and replace it with a well formed entry.
        return None

    if time.time() - issued_at >= SESSION_TTL_SECONDS - REFRESH_MARGIN_SECONDS:
        return None

    return session


def login():
    """Log in to the target system and return the session it gives back."""
    response = requests.post(
        required_secret("ACME_LOGIN_URL"),
        json={
            "username": required_secret("ACME_USERNAME"),
            "password": required_secret("ACME_PASSWORD"),
        },
        timeout=LOGIN_TIMEOUT_SECONDS,
        # A 307 or 308 redirect re-sends the POST body, the password included,
        # to wherever the response points. Never follow one.
        allow_redirects=False,
    )
    response.raise_for_status()
    return response.json()["session"]


def store_session(session):
    """Write the session back to the project secret, with the time it was issued.

    A failure here does not fail the row: the row already holds a working
    session, and the only cost is that the next row logs in again. It is
    reported on stderr, which the run shows, and it never carries the session.
    """
    entry = json.dumps({"session": session, "issued_at": int(time.time())})

    try:
        existing_id = find_secret_id(SESSION_SECRET_NAME)
        if existing_id is None:
            created = secrets_request(
                "POST",
                "/api/secrets",
                body={"name": SESSION_SECRET_NAME, "value": entry},
            )
            if created.status_code == 409:
                # Another row of the same wave created it first. Overwrite it:
                # both sessions are valid, and the last write wins.
                existing_id = find_secret_id(SESSION_SECRET_NAME)
                if existing_id is None:
                    raise RuntimeError(
                        f"secret {SESSION_SECRET_NAME} reported as existing but was not listed"
                    )
            else:
                created.raise_for_status()
                return

        secrets_request(
            "PUT", f"/api/secrets/{existing_id}", body={"value": entry}
        ).raise_for_status()
    except Exception as error:  # noqa: BLE001 - the row must still answer
        print(
            f"could not store {SESSION_SECRET_NAME}, the next row will log in again: {error}",
            file=sys.stderr,
        )


def find_secret_id(name):
    """Return the id of the project secret with this name, or None."""
    listing = secrets_request("GET", "/api/secrets")
    listing.raise_for_status()
    for secret in listing.json():
        if secret.get("name") == name:
            return secret["id"]
    return None


def secrets_request(method, path, body=None):
    """Call the LangWatch secrets API with the project API key.

    LANGWATCH_API_KEY holds project access, so keep it in the secret store and
    send it to LANGWATCH_ENDPOINT and nowhere else.
    """
    endpoint = required_secret("LANGWATCH_ENDPOINT").rstrip("/")
    return requests.request(
        method,
        f"{endpoint}{path}",
        headers={"X-Auth-Token": required_secret("LANGWATCH_API_KEY")},
        json=body,
        timeout=STORE_TIMEOUT_SECONDS,
    )


def required_secret(name):
    """Read a project secret, and name it when the project does not hold it."""
    value = optional_secret(name)
    if value is None:
        raise RuntimeError(
            f"project secret {name} is missing. Add it in Settings -> Secrets."
        )
    return value


def optional_secret(name):
    """Read a project secret, or None. `secrets` is undefined when empty."""
    namespace = globals().get("secrets")
    if namespace is None:
        return None
    value = getattr(namespace, name, None)
    return value if value else None
