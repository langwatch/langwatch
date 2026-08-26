# Log in once and share the session across the rows of a run.
#
# Rows are isolated, so each one starts cold and a login on every row is the
# default result. This agent keeps one session in the project's agent cache and
# reads it back at the start of every row. The rows that start at the same
# moment all read an empty cache, so one of them takes a claim and logs in
# while the rest wait for what it stores. A row that finds the target no longer
# accepts the stored session logs in again and stores the new one, so a session
# the target ends early costs one login rather than the run.
#
# The platform gives the sandbox its own LangWatch credential, so there is no
# setup call to write and no LangWatch secret to create. The runner injects
# `secrets` as a namespace (not the stdlib module of that name), the entry
# point is `class Code` with `__call__`, and every declared output key must be
# returned.

import sys
import time

import langwatch
import requests

SESSION_ENTRY_NAME = "ACME_SESSION"  # the cache entry that holds the session
LOGIN_CLAIM_NAME = "ACME_LOGIN_CLAIM"  # the name one row takes to log in
SESSION_TTL_SECONDS = 15 * 60  # the lifetime the target system returns
REFRESH_MARGIN_SECONDS = 60  # store it for less, so it is never sent stale
CLAIM_TTL_SECONDS = 15  # a row that stops before it stores frees the name
LOGIN_WAIT_TICKS = 20  # how long a row waits for the row that took the name
REFUSED = object()  # the target would not accept the session this row sent


class Code:
    def __call__(self, message: str):
        reply = self.ask(message, get_session())
        if reply is REFUSED:
            # The stored session is no longer one the target accepts. A target
            # ends a session whenever it likes: a restart, an operator closing
            # it, a password change. The lifetime it returned is the most this
            # agent can assume, never a guarantee. So log in again and send
            # this row once more, which also stores the new session for the
            # rows that follow.
            report("was refused", "this row logs in again")
            reply = self.ask(message, renew_session())
            if reply is REFUSED:
                raise RuntimeError(
                    "ACME refused a session this row obtained a moment ago."
                )
        return {"output": reply}

    def ask(self, message, session):
        """Send one row, or report that the session was refused."""
        response = requests.post(
            secret("ACME_API_URL"),
            json={"message": message},
            headers={"Authorization": f"Bearer {session}"},
            timeout=30,
        )
        if response.status_code == 401:
            return REFUSED
        # raise_for_status names the URL and the status code and nothing else.
        response.raise_for_status()
        return response.json()["reply"]


def get_session():
    """Return a session token. This is the one line each row calls."""
    stored = read_session()
    if stored:
        return stored

    # A claim writes only when the name is free, so of the rows that read the
    # empty cache together exactly one takes it and logs in. The rows that did
    # not take it wait for the session that row stores, and claim again on
    # every tick: a row that stops before it stores frees the name, and the
    # next tick is where another row picks the work up.
    for _ in range(LOGIN_WAIT_TICKS):
        if take_the_login():
            return renew_session()
        time.sleep(1)
        stored = read_session()
        if stored:
            return stored

    # No row stored a session inside the window. This row logs in on its own,
    # which is the result every row gets with no claim at all.
    report("was not stored in time", "this row logs in")
    return renew_session()


def read_session():
    """Read the stored session. A cache that cannot answer reads as a miss."""
    try:
        return langwatch.cache.get(SESSION_ENTRY_NAME)
    except Exception:  # noqa: BLE001 - a cache that cannot answer is a miss
        report("could not be read", "this row logs in")
        return None


def take_the_login():
    """Answer whether this row is the one that logs in.

    A cache that cannot answer means every row logs in, which is the result
    with no claim at all, so the row goes on rather than stopping.
    """
    try:
        return langwatch.cache.claim(
            LOGIN_CLAIM_NAME, "taken", ttl_seconds=CLAIM_TTL_SECONDS
        )
    except Exception:  # noqa: BLE001 - the row must still answer
        return True


def renew_session():
    """Log in and store the session, for this row and the rows that follow."""
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
    lifetime the target system returned. A failure here does not fail the row:
    this row holds a working session already, and the only cost is that the
    next row logs in again."""
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
