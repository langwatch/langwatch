# Log in once and share the session across the rows of a run.
#
# Rows are isolated, so each one starts cold and a login on every row is the
# default result. This agent keeps one session in the project's agent cache and
# reads it back at the start of every row, so only the rows that start at the
# same moment log in.
#
# The platform gives the sandbox its own LangWatch credential, so there is no
# setup call to write and no LangWatch secret to create. The runner injects
# `secrets` as a namespace (not the stdlib module of that name), the entry
# point is `class Code` with `__call__`, and every declared output key must be
# returned.

import sys

import langwatch
import requests

SESSION_ENTRY_NAME = "ACME_SESSION"  # the cache entry that holds the session
SESSION_TTL_SECONDS = 15 * 60  # what the target system promises
REFRESH_MARGIN_SECONDS = 60  # store it for less, so it is never sent stale


class Code:
    def __call__(self, message: str):
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
    try:
        stored = langwatch.cache.get(SESSION_ENTRY_NAME)
    except Exception:  # noqa: BLE001 - a cache that cannot answer is a miss
        report("could not be read", "this row logs in")
        stored = None
    if stored:
        return stored

    session = login()
    store_session(session)
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
    """Store the session for the rows that follow, for a little less than the
    target system promises. A failure here does not fail the row: this row
    holds a working session already, and the only cost is that the next row
    logs in again."""
    try:
        langwatch.cache.set(
            SESSION_ENTRY_NAME,
            session,
            ttl_seconds=SESSION_TTL_SECONDS - REFRESH_MARGIN_SECONDS,
        )
    except Exception:  # noqa: BLE001 - the row must still answer
        report("could not be stored", "the next row will log in again")


def report(state, consequence):
    """Say on stderr what the cache did, in this agent's own words.

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
