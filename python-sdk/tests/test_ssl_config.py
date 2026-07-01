"""
Tests for Client._get_ssl_config() — SSL verification configuration via environment variables.
"""

import logging

import pytest

from langwatch.client import Client


@pytest.fixture(autouse=True)
def reset_client():
    """Ensure each test starts with a clean Client state."""
    Client.reset_for_testing()
    yield
    Client.reset_for_testing()


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Remove SSL-related env vars so tests are isolated."""
    monkeypatch.delenv("LANGWATCH_SSL_VERIFY", raising=False)
    monkeypatch.delenv("LANGWATCH_CA_BUNDLE", raising=False)


class TestGetSslConfigDefault:
    def test_returns_none_when_no_env_vars_set(self):
        assert Client._get_ssl_config() is None

    def test_returns_none_when_ssl_verify_is_true(self, monkeypatch):
        monkeypatch.setenv("LANGWATCH_SSL_VERIFY", "true")
        assert Client._get_ssl_config() is None


class TestGetSslConfigDisableVerify:
    @pytest.mark.parametrize(
        "value",
        ["false", "False", "FALSE", "0", "no", "No", "disable", "DISABLE"],
    )
    def test_returns_false_for_disable_values(self, monkeypatch, value):
        monkeypatch.setenv("LANGWATCH_SSL_VERIFY", value)
        assert Client._get_ssl_config() is False

    def test_ssl_verify_false_takes_precedence_over_ca_bundle(
        self, monkeypatch, tmp_path
    ):
        ca_file = tmp_path / "ca.pem"
        ca_file.write_text("fake cert content")
        monkeypatch.setenv("LANGWATCH_SSL_VERIFY", "false")
        monkeypatch.setenv("LANGWATCH_CA_BUNDLE", str(ca_file))
        assert Client._get_ssl_config() is False


class TestGetSslConfigCaBundle:
    def test_returns_path_when_file_exists(self, monkeypatch, tmp_path):
        ca_file = tmp_path / "corporate-ca.pem"
        ca_file.write_text("-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----")
        monkeypatch.setenv("LANGWATCH_CA_BUNDLE", str(ca_file))
        assert Client._get_ssl_config() == str(ca_file)

    def test_returns_none_when_file_does_not_exist(self, monkeypatch):
        monkeypatch.setenv("LANGWATCH_CA_BUNDLE", "/nonexistent/path/ca.pem")
        assert Client._get_ssl_config() is None

    def test_returns_none_when_ca_bundle_is_empty_string(self, monkeypatch):
        monkeypatch.setenv("LANGWATCH_CA_BUNDLE", "")
        assert Client._get_ssl_config() is None


class TestGetSslConfigLogging:
    def test_logs_warning_when_ca_file_missing(self, monkeypatch, caplog):
        monkeypatch.setenv("LANGWATCH_CA_BUNDLE", "/no/such/file.pem")
        with caplog.at_level(logging.WARNING):
            Client._get_ssl_config()
        assert "does not exist" in caplog.text
        assert "/no/such/file.pem" in caplog.text

    def test_logs_info_when_ssl_verify_disabled(self, monkeypatch, caplog):
        monkeypatch.setenv("LANGWATCH_SSL_VERIFY", "false")
        with caplog.at_level(logging.INFO):
            Client._get_ssl_config()
        assert "SSL certificate" in caplog.text

    def test_ssl_disabled_warning_emitted_only_once(self, monkeypatch, caplog):
        monkeypatch.setenv("LANGWATCH_SSL_VERIFY", "false")
        with caplog.at_level(logging.INFO):
            Client._get_ssl_config()
            Client._get_ssl_config()
            Client._get_ssl_config()
        assert caplog.text.count("SSL certificate") == 1

    def test_ssl_disabled_warning_resets_after_reset_for_testing(
        self, monkeypatch, caplog
    ):
        monkeypatch.setenv("LANGWATCH_SSL_VERIFY", "false")
        with caplog.at_level(logging.INFO):
            Client._get_ssl_config()
        assert caplog.text.count("SSL certificate") == 1

        # Reset and call again — should warn again
        Client.reset_for_testing()
        caplog.clear()
        with caplog.at_level(logging.INFO):
            Client._get_ssl_config()
        assert caplog.text.count("SSL certificate") == 1

    def test_logs_info_when_using_custom_ca_bundle(self, monkeypatch, tmp_path, caplog):
        ca_file = tmp_path / "ca.pem"
        ca_file.write_text("fake cert")
        monkeypatch.setenv("LANGWATCH_CA_BUNDLE", str(ca_file))
        with caplog.at_level(logging.INFO):
            Client._get_ssl_config()
        assert "Using custom CA bundle" in caplog.text
        assert str(ca_file) in caplog.text
