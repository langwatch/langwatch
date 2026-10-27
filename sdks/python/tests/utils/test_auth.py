"""Unit tests for the PAT-aware auth header helper."""

from __future__ import annotations

import base64

import pytest

from langwatch.utils.auth import (
    build_auth_headers,
    is_personal_access_token,
    requires_project_header,
)

# A token whose body matches the server's strict new-format shape:
# {16 alphanumerics}_{48 alphanumerics}.
NEW_FORMAT_KEY = "sk-lw-" + "a" * 16 + "_" + "b" * 48
INGEST_KEY = "ik-lw-" + "c" * 16 + "_" + "d" * 48


class TestIsPersonalAccessToken:
    def test_returns_true_for_pat_prefix(self) -> None:
        assert is_personal_access_token("pat-lw-abc_def") is True

    def test_returns_false_for_legacy_key(self) -> None:
        assert is_personal_access_token("sk-lw-123") is False

    def test_returns_false_for_empty_string(self) -> None:
        assert is_personal_access_token("") is False


class TestRequiresProjectHeader:
    def test_new_format_api_key_requires_a_project(self) -> None:
        assert requires_project_header(NEW_FORMAT_KEY) is True

    def test_ingest_key_requires_a_project(self) -> None:
        assert requires_project_header(INGEST_KEY) is True

    def test_legacy_project_key_does_not(self) -> None:
        assert requires_project_header("sk-lw-" + "a" * 48) is False

    def test_underscore_alone_does_not_make_a_key_new_format(self) -> None:
        # Legacy keys were minted from alphabets that include `_` and `-`, so
        # the mere presence of an underscore must not reclassify them.
        assert requires_project_header("sk-lw-abc_def") is False
        assert requires_project_header("sk-lw-" + "a" * 16 + "_" + "b" * 47) is False
        assert requires_project_header("sk-lw-" + "a" * 15 + "_" + "b" * 48) is False

    def test_dash_in_body_is_not_new_format(self) -> None:
        dashed = "sk-lw-" + "a" * 16 + "_" + "b" * 47 + "-"
        assert requires_project_header(dashed) is False

    def test_pat_does_not_use_the_project_header(self) -> None:
        # PATs need a project too, but carry it via Basic auth instead.
        assert requires_project_header("pat-lw-abc_secret") is False

    def test_empty_string(self) -> None:
        assert requires_project_header("") is False


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

    def test_new_format_key_emits_project_header(self) -> None:
        headers = build_auth_headers(
            api_key=NEW_FORMAT_KEY,
            project_id="project_123",
        )
        assert headers == {
            "Authorization": f"Bearer {NEW_FORMAT_KEY}",
            "X-Auth-Token": NEW_FORMAT_KEY,
            "X-Project-Id": "project_123",
        }

    def test_new_format_key_falls_back_to_env_project_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LANGWATCH_PROJECT_ID", "env_project")
        headers = build_auth_headers(api_key=NEW_FORMAT_KEY)
        assert headers["X-Project-Id"] == "env_project"

    def test_new_format_key_without_project_id_omits_the_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("LANGWATCH_PROJECT_ID", raising=False)
        headers = build_auth_headers(api_key=NEW_FORMAT_KEY)
        assert headers == {
            "Authorization": f"Bearer {NEW_FORMAT_KEY}",
            "X-Auth-Token": NEW_FORMAT_KEY,
        }

    def test_ingest_key_emits_project_header(self) -> None:
        headers = build_auth_headers(api_key=INGEST_KEY, project_id="project_123")
        assert headers["X-Project-Id"] == "project_123"

    def test_legacy_key_with_project_id_omits_the_header(self) -> None:
        # Legacy keys are self-identifying and the server ignores a supplied
        # project for them, so their header shape must not change.
        headers = build_auth_headers(
            api_key="sk-lw-legacy",
            project_id="project_123",
        )
        assert headers == {
            "Authorization": "Bearer sk-lw-legacy",
            "X-Auth-Token": "sk-lw-legacy",
        }
