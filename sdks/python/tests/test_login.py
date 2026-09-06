import pytest
from unittest.mock import patch, MagicMock
import httpx

from langwatch.login import login
from langwatch.state import get_api_key, get_endpoint # noqa: F401 # Assuming these are directly importable for patching

# Test cases
# 1. Already logged in, no relogin
# 2. Not logged in, successful login
# 3. Not logged in, empty API key entered
# 4. Not logged in, invalid API key entered
# 5. Not logged in, API call fails (non-401)
# 6. Relogin flag is True, successful login

def test_login_already_logged_in_no_relogin(capsys):
    with patch("langwatch.login.get_api_key", return_value="fake_api_key"), \
         patch("langwatch.login.langwatch.setup") as mock_setup, \
         patch("langwatch.login.getpass") as mock_getpass, \
         patch("langwatch.login.httpx.post") as mock_post:

        login(relogin=False)

        mock_setup.assert_not_called()
        mock_getpass.assert_not_called()
        mock_post.assert_not_called()
        captured = capsys.readouterr()
        assert "LangWatch API key is already set" in captured.out

def test_login_successful(capsys):
    with patch("langwatch.login.get_api_key", return_value=""), \
         patch("langwatch.login.langwatch.setup") as mock_setup, \
         patch("langwatch.login.get_endpoint", return_value="http://fake-endpoint.internal") as mock_get_endpoint, \
         patch("langwatch.login.getpass", return_value="new_valid_key") as mock_getpass, \
         patch("langwatch.login.httpx.post") as mock_post:

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        login()

        assert mock_get_endpoint.call_count == 2
        mock_getpass.assert_called_once_with("Paste your API key here: ")
        mock_post.assert_called_once_with(
            "http://fake-endpoint.internal/api/auth/validate",
            headers={"X-Auth-Token": "new_valid_key"},
            json={},
        )
        mock_response.raise_for_status.assert_called_once()
        mock_setup.assert_called_once_with(api_key="new_valid_key")
        captured = capsys.readouterr()
        assert "Please go to http://fake-endpoint.internal/authorize" in captured.out
        assert "LangWatch API key set" in captured.out

def test_login_successful_with_relogin(capsys):
    with patch("langwatch.login.get_api_key", return_value="old_fake_key"), \
         patch("langwatch.login.langwatch.setup") as mock_setup, \
         patch("langwatch.login.get_endpoint", return_value="http://fake-endpoint.internal") as mock_get_endpoint, \
         patch("langwatch.login.getpass", return_value="new_valid_key_relogin") as mock_getpass, \
         patch("langwatch.login.httpx.post") as mock_post:

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        login(relogin=True)

        assert mock_get_endpoint.call_count == 2
        mock_getpass.assert_called_once_with("Paste your API key here: ")
        mock_post.assert_called_once_with(
            "http://fake-endpoint.internal/api/auth/validate",
            headers={"X-Auth-Token": "new_valid_key_relogin"},
            json={},
        )
        mock_response.raise_for_status.assert_called_once()
        mock_setup.assert_called_once_with(api_key="new_valid_key_relogin")
        captured = capsys.readouterr()
        assert "Please go to http://fake-endpoint.internal/authorize" in captured.out
        assert "LangWatch API key set" in captured.out


def test_login_empty_api_key_entered(capsys):
    with patch("langwatch.login.get_api_key", return_value=""), \
         patch("langwatch.login.get_endpoint", return_value="http://fake-endpoint.internal") as mock_get_endpoint, \
         patch("langwatch.login.getpass", return_value="") as mock_getpass, \
         patch("langwatch.login.httpx.post") as mock_post:

        with pytest.raises(ValueError) as excinfo:
            login()

        assert "API key was not set" in str(excinfo.value)
        mock_get_endpoint.assert_called_once()
        mock_getpass.assert_called_once_with("Paste your API key here: ")
        mock_post.assert_not_called()
        captured = capsys.readouterr()
        assert "Please go to http://fake-endpoint.internal/authorize" in captured.out


def test_login_invalid_api_key(capsys):
    with patch("langwatch.login.get_api_key", return_value=""), \
         patch("langwatch.login.langwatch.setup") as mock_setup, \
         patch("langwatch.login.get_endpoint", return_value="http://fake-endpoint.internal") as mock_get_endpoint, \
         patch("langwatch.login.getpass", return_value="invalid_key") as mock_getpass, \
         patch("langwatch.login.httpx.post") as mock_post:

        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_post.return_value = mock_response

        with pytest.raises(ValueError) as excinfo:
            login()

        assert "API key is not valid, please try to login again" in str(excinfo.value)
        assert mock_get_endpoint.call_count == 2
        mock_getpass.assert_called_once_with("Paste your API key here: ")
        mock_post.assert_called_once_with(
            "http://fake-endpoint.internal/api/auth/validate",
            headers={"X-Auth-Token": "invalid_key"},
            json={},
        )
        mock_response.raise_for_status.assert_not_called() # raise_for_status is not called directly on 401
        mock_setup.assert_not_called()
        captured = capsys.readouterr()
        assert "Please go to http://fake-endpoint.internal/authorize" in captured.out

def test_login_api_call_fails_non_401(capsys):
    with patch("langwatch.login.get_api_key", return_value=""), \
         patch("langwatch.login.langwatch.setup") as mock_setup, \
         patch("langwatch.login.get_endpoint", return_value="http://fake-endpoint.internal") as mock_get_endpoint, \
         patch("langwatch.login.getpass", return_value="some_key") as mock_getpass, \
         patch("langwatch.login.httpx.post") as mock_post:

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server Error", request=MagicMock(), response=mock_response
        )
        mock_post.return_value = mock_response

        with pytest.raises(httpx.HTTPStatusError):
            login()

        assert mock_get_endpoint.call_count == 2
        mock_getpass.assert_called_once_with("Paste your API key here: ")
        mock_post.assert_called_once_with(
            "http://fake-endpoint.internal/api/auth/validate",
            headers={"X-Auth-Token": "some_key"},
            json={},
        )
        mock_response.raise_for_status.assert_called_once()
        mock_setup.assert_not_called()
        captured = capsys.readouterr()
        assert "Please go to http://fake-endpoint.internal/authorize" in captured.out
