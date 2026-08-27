# Log in once and share the session across the rows of a run.
#
# Rows are isolated, so each one starts cold and logs in on its own. This agent
# keeps the session in the project's agent cache. Of the rows that start
# together, one takes the claim and logs in while the rest wait for what it
# stores. A row the target refuses logs in again and stores the new session.
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

SESSION_NAME = "ACME_SESSION"  # the cache entry, and the claim that guards it
SESSION_TTL_SECONDS = 14 * 60  # under what the target gives, so it is never stale
LOGIN_SECONDS = 15  # over what a login takes: how long one row holds the claim
REFUSED = object()


class Code:
    def __call__(self, message: str):
        reply = self.ask(message, get_session())
        if reply is REFUSED:
            # A target ends a session whenever it likes: a restart, an operator
            # closing it, a password change. The lifetime it returned is the
            # most this agent can assume, so a refusal costs one login.
            report("was refused", "this row logs in again")
            reply = self.ask(message, renew_session())
            if reply is REFUSED:
                raise RuntimeError("ACME refused a session obtained a moment ago.")
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
    """Return a session, stored by another row or obtained by this one.

    The loop always ends: either a session appears, or the claim comes free.
    A row that takes the claim and then stops frees it after LOGIN_SECONDS,
    and the next pass is where another row picks the work up.
    """
    while True:
        stored = read_session()
        if stored:
            return stored
        if take_the_login():
            return renew_session()
        time.sleep(1)


def read_session():
    """The stored session, or None. A cache that cannot answer is a miss."""
    try:
        return langwatch.cache.get(SESSION_NAME)
    except Exception:  # noqa: BLE001 - the row must still answer
        report("could not be read", "this row logs in")
        return None


def take_the_login():
    """Whether this row is the one that logs in.

    A cache that cannot answer means every row logs in, which is the result
    with no claim at all, so the row goes on rather than stopping.
    """
    try:
        return langwatch.cache.claim(
            f"{SESSION_NAME}_CLAIM", "taken", ttl_seconds=LOGIN_SECONDS
        )
    except Exception:  # noqa: BLE001 - the row must still answer
        return True


def renew_session():
    """Log in, and store the session for the rows that follow."""
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
    """Store it for the rows that follow. A failure here costs the next row a
    login, never this row's answer."""
    try:
        langwatch.cache.set(SESSION_NAME, session, ttl_seconds=SESSION_TTL_SECONDS)
    except Exception:  # noqa: BLE001 - the row must still answer
        report("could not be stored", "the next row will log in again")


def report(state, consequence):
    """Say on stderr what the cache did, in this agent's own fixed words. An
    exception text can quote the credential that caused it, and a run shows
    what it printed."""
    print(f"{SESSION_NAME} {state}, {consequence}", file=sys.stderr)


def secret(name):
    """Read a project secret, and name it when the project does not hold it."""
    namespace = globals().get("secrets")
    value = getattr(namespace, name, None) if namespace else None
    if not value:
        raise RuntimeError(
            f"project secret {name} is missing. Add it in Settings -> Secrets."
        )
    return value
