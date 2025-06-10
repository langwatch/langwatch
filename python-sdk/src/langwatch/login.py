import httpx

import langwatch
from .state import get_api_key, get_endpoint
from getpass import getpass



def login(relogin=False):
    if not relogin and get_api_key() != "":
        print(
            "LangWatch API key is already set, if you want to login again, please call as langwatch.login(relogin=True)"
        )
        return

    print(f"Please go to {get_endpoint()}/authorize to get your API key")
    api_key = getpass("Paste your API key here: ")
    if not api_key:
        raise ValueError("API key was not set")

    response = httpx.post(
        f"{get_endpoint()}/api/auth/validate",
        headers={"X-Auth-Token": api_key or ""},
        json={},
    )
    if response.status_code == 401:
        raise ValueError("API key is not valid, please try to login again")
    response.raise_for_status()

    langwatch.setup(api_key=api_key)
    print("LangWatch API key set")
