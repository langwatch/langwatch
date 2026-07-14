"""Unit tests for the PAT-aware auth header helper."""

from __future__ import annotations

import base64

import pytest

from langwatch.utils.auth import build_auth_headers, is_personal_access_token


class TestIsPersonalAccessToken:
    def test_returns_true_for_pat_prefix(self) -> None:
        assert is_personal_access_token("pat-lw-abc_def") is True

    def test_returns_false_for_legacy_key(self) -> None:
        assert is_personal_access_token("sk-lw-123") is False

    def test_returns_false_for_empty_string(self) -> None:
        assert is_personal_access_token("") is False


class TestBuildAuthHeaders:
    def test_returns_empty_dict_when_api_key_is_empty(self) -> None:
        assert build_auth_headers(api_key="") == {}

    def test_legacy_key_emits_bearer_and_x_auth_token(self) -> None:
        headers = build_auth_headers(api_key="sk-lw-legacy")
        assert headers == {
            "Authorization": "Bearer sk-lw-legacy",
            "X-Auth-Token": "sk-lw-legacy",
        }

    def test_pat_with_project_id_emits_basic_auth(self) -> None:
        headers = build_auth_headers(
            api_key="pat-lw-abc_secret",
            project_id="project_123",
        )
        expected = base64.b64encode(
            b"project_123:pat-lw-abc_secret"
        ).decode("utf-8")
        assert headers == {"Authorization": f"Basic {expected}"}

    def test_pat_falls_back_to_env_project_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LANGWATCH_PROJECT_ID", "env_project")
        headers = build_auth_headers(api_key="pat-lw-envtok")
        expected = base64.b64encode(b"env_project:pat-lw-envtok").decode("utf-8")
        assert headers == {"Authorization": f"Basic {expected}"}

    def test_pat_without_project_id_falls_back_to_bearer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("LANGWATCH_PROJECT_ID", raising=False)
        headers = build_auth_headers(api_key="pat-lw-nopid")
        assert headers == {
            "Authorization": "Bearer pat-lw-nopid",
            "X-Auth-Token": "pat-lw-nopid",
        }
