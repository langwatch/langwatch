# Canonical authenticated code agent: OAuth2 client-credentials (Auth0 M2M).
#
# This is the reference implementation for a LangWatch custom code agent that
# calls an API protected by Auth0 machine-to-machine auth. It is executed —
# not just read — by auth0_example_test.go in the parent package, through the
# same runner.py that runs every code agent in production. langwatch/langwatch#6337.
#
# Contract notes (things the sandbox enforces, in the order people trip on them):
#   - Entry point: `class Code` with `__call__` — one of the four shapes
#     runner.py resolves. No constructor args.
#   - `secrets` is a namespace injected into the module globals by runner.py.
#     It is NOT the stdlib `secrets` module — do not `import secrets`, that
#     would shadow the injected namespace and break credential resolution.
#   - `os.environ` is NOT populated with project secrets in the sandbox.
#   - Every declared output key must be returned, or the run fails with
#     KeyError("missing_output: ...").
#   - Only `requests`, `httpx`, `pydantic` and `langwatch` are installed.
#   - The whole call — token fetch plus downstream request — must fit the
#     runner's wall-clock budget (60s default).

import requests


class Code:
    # The ONLY input is the conversation message. Everything else — the
    # credentials AND the endpoint coordinates — comes from project secrets,
    # so the whole agent is configurable from Settings -> Secrets and the one
    # scenario mapping it needs (message <- scenario input) is creatable in
    # the UI today. Static value mappings are deliberately avoided: they
    # cannot be created in the editor yet (langwatch/langwatch#6371).
    def __call__(self, message: str):
        # Step 1: exchange the client credentials for an access token.
        # Auth0's canonical M2M example posts JSON to /oauth/token.
        token_response = requests.post(
            secrets.AUTH0_TOKEN_URL,  # noqa: F821 — `secrets` is injected by runner.py
            json={
                "grant_type": "client_credentials",
                "client_id": secrets.AUTH0_CLIENT_ID,  # noqa: F821
                "client_secret": secrets.AUTH0_CLIENT_SECRET,  # noqa: F821
                "audience": secrets.AUTH0_AUDIENCE,  # noqa: F821
            },
            timeout=10,
            # A 307/308 redirect would re-send the POST body, credential
            # included, to wherever the response points. Never follow one.
            allow_redirects=False,
        )
        # raise_for_status embeds the URL and status code, never the request
        # body — so a rejected credential fails loudly without leaking it.
        token_response.raise_for_status()
        access_token = token_response.json()["access_token"]

        # Step 2: call the protected API with the minted token.
        api_response = requests.post(
            secrets.AUTH0_API_URL,  # noqa: F821
            json={"message": message},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30,
        )
        api_response.raise_for_status()

        return {"output": api_response.json()["reply"]}
