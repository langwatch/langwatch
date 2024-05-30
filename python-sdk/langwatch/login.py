import httpx
import langwatch
from getpass import getpass


def login(relogin=False):
    if not relogin and langwatch.api_key:
        print(
            "LangWatch API key is already set, if you want to login again, please call as langwatch.login(relogin=True)"
        )
        return
    print(f"Please go to {langwatch.endpoint}/authorize to get your API key")
    api_key = getpass(f"Paste your API key here: ")
    if not api_key:
        raise ValueError("API key was not set")

    response = httpx.post(
        f"{langwatch.endpoint}/api/auth/validate",
        headers={"X-Auth-Token": api_key or ""},
        json={},
    )
    if response.status_code == 401:
        raise ValueError("API key is not valid, please try to login again")
    response.raise_for_status()

    langwatch.api_key = api_key
    print("LangWatch API key set")
