# Log in once and share the session across the rows of a run.
#
# Rows are isolated, so each one starts cold and a login on every row is the
# default result. This agent keeps one session in the project's encrypted
# secret store and reads it back through the LangWatch SDK at the start of
# every row, so only the rows that start at the same moment log in.
#
# The runner injects `secrets` as a namespace (not the stdlib module of that
# name), the entry point is `class Code` with `__call__`, and every declared
# output key must be returned.

import json
import sys
import time

import langwatch
import requests

SESSION_ENTRY_NAME = "ACME_SESSION"  # the project secret that holds the session
SESSION_TTL_SECONDS = 15 * 60  # what the target system promises
REFRESH_MARGIN_SECONDS = 60  # refresh this early; keep it under the TTL


class Code:
    def __call__(self, message: str):
        langwatch.setup(
            api_key=secret("LANGWATCH_API_KEY"),
            endpoint_url=secret("LANGWATCH_ENDPOINT"),
            # The run already reports this row; a second exporter only adds
            # work inside the runner's time budget.
            skip_open_telemetry_setup=True,
        )

        response = requests.post(
            secret("ACME_API_URL"),
            json={"message": message},
            headers={"Authorization": f"Bearer {get_session()}"},
            timeout=30,
        )
        # raise_for_status names the URL and the status code and nothing else.
        response.raise_for_status()

        return {"output": response.json()["reply"]}


def get_session():
    """Return a session token. This is the one line each row calls."""
    stored = read_stored_session()
    if stored is not None:
        return stored

    session = login()
    store_session(session)
    return session


def read_stored_session():
    """Return the stored session while it is fresh, else None."""
    try:
        entry = json.loads(langwatch.secrets.get_value(SESSION_ENTRY_NAME))
        session = entry["session"]
        age = time.time() - float(entry["issued_at"])
    except Exception:  # noqa: BLE001 - no stored session is a valid answer
        report("is not stored yet, or could not be read", "this row logs in")
        return None

    # Anything this agent did not write is a miss, never a token to send: an
    # empty or non-string session becomes an empty Bearer header, and an age
    # that is negative or not a number comes from a hand-written entry.
    if not isinstance(session, str) or not session:
        report("does not hold a session", "this row logs in")
        return None
    if not 0 <= age < SESSION_TTL_SECONDS - REFRESH_MARGIN_SECONDS:
        return None
    return session


def login():
    """Log in to the target system and return the session it gives back."""
    response = requests.post(
        secret("ACME_LOGIN_URL"),
        json={
            "username": secret("ACME_USERNAME"),
            "password": secret("ACME_PASSWORD"),
        },
        timeout=10,
        # A 307 or 308 redirect re-sends the POST body, password included.
        allow_redirects=False,
    )
    response.raise_for_status()
    return response.json()["session"]


def store_session(session):
    """Write the session back, with the time it was issued. A failure here does
    not fail the row: the row holds a working session already, and the only
    cost is that the next row logs in again."""
    entry = json.dumps({"session": session, "issued_at": int(time.time())})
    try:
        langwatch.secrets.set(SESSION_ENTRY_NAME, entry)
    except Exception:  # noqa: BLE001 - the row must still answer
        report("could not be stored", "the next row will log in again")


def report(state, consequence):
    """Say on stderr what the store did, in this agent's own words.

    Nothing from the exception reaches the output. An error message can quote
    the credential that caused it, and a run shows stderr.
    """
    print(f"{SESSION_ENTRY_NAME} {state}, {consequence}", file=sys.stderr)


def secret(name):
    """Read a project secret, and name it when the project does not hold it."""
    namespace = globals().get("secrets")
    value = getattr(namespace, name, None) if namespace else None
    if not value:
        raise RuntimeError(
            f"project secret {name} is missing. Add it in Settings -> Secrets."
        )
    return value
