"""A trailing slash on the endpoint must not reach the URL builders.

Request URLs are built as ``f"{get_endpoint()}/api/experiment/init"``, so an
endpoint written as ``https://app.langwatch.ai/`` produced a double slash the
router does not match, and the caller saw an opaque 404.
"""

from unittest.mock import patch

import langwatch
from langwatch.client import Client
from langwatch.state import DEFAULT_ENDPOINT, get_endpoint, normalize_endpoint


class TestNormalizeEndpoint:
    def test_strips_a_trailing_slash(self) -> None:
        assert normalize_endpoint("https://app.langwatch.ai/") == "https://app.langwatch.ai"

    def test_strips_repeated_trailing_slashes(self) -> None:
        assert normalize_endpoint("http://localhost:5560///") == "http://localhost:5560"

    def test_trims_surrounding_whitespace(self) -> None:
        assert normalize_endpoint("  https://app.langwatch.ai/  ") == "https://app.langwatch.ai"

    def test_leaves_a_clean_endpoint_untouched(self) -> None:
        assert normalize_endpoint("https://app.langwatch.ai") == "https://app.langwatch.ai"


class TestGetEndpointWithoutAClient:
    def test_strips_the_trailing_slash_from_the_environment(self) -> None:
        with patch.dict("os.environ", {"LANGWATCH_ENDPOINT": "https://app.langwatch.ai/"}):
            assert get_endpoint() == "https://app.langwatch.ai"

    def test_falls_back_to_the_default_when_the_environment_is_blank(self) -> None:
        with patch.dict("os.environ", {"LANGWATCH_ENDPOINT": "   "}):
            assert get_endpoint() == DEFAULT_ENDPOINT


class TestClientSetup:
    def test_falls_back_to_the_default_when_the_explicit_endpoint_is_blank(self) -> None:
        Client.reset_for_testing()
        try:
            client = Client(
                api_key="test-key",
                endpoint_url="   ",
                skip_open_telemetry_setup=True,
            )
            assert client.endpoint_url == DEFAULT_ENDPOINT
        finally:
            Client.reset_for_testing()

    def test_falls_back_to_the_default_when_the_explicit_endpoint_is_only_slashes(
        self,
    ) -> None:
        Client.reset_for_testing()
        try:
            client = Client(
                api_key="test-key",
                endpoint_url="///",
                skip_open_telemetry_setup=True,
            )
            assert client.endpoint_url == DEFAULT_ENDPOINT
        finally:
            Client.reset_for_testing()

    def test_normalizes_when_reconfiguring_an_existing_instance(self) -> None:
        Client.reset_for_testing()
        try:
            Client(
                api_key="test-key",
                endpoint_url="https://first.example.com",
                skip_open_telemetry_setup=True,
            )
            reconfigured = Client(endpoint_url="  https://second.example.com///  ")
            assert reconfigured.endpoint_url == "https://second.example.com"
        finally:
            Client.reset_for_testing()

    def test_keeps_the_endpoint_when_reconfigured_with_a_blank_value(self) -> None:
        """A blank argument must not move a self-hosted client to the cloud."""
        Client.reset_for_testing()
        try:
            Client(
                api_key="test-key",
                endpoint_url="https://self.hosted.example.com",
                skip_open_telemetry_setup=True,
            )
            reconfigured = Client(endpoint_url="   ")
            assert reconfigured.endpoint_url == "https://self.hosted.example.com"
        finally:
            Client.reset_for_testing()

    def test_stores_the_endpoint_without_its_trailing_slash(self) -> None:
        Client.reset_for_testing()
        try:
            client = Client(
                api_key="test-key",
                endpoint_url="https://app.langwatch.ai/",
                skip_open_telemetry_setup=True,
            )
            assert client.endpoint_url == "https://app.langwatch.ai"
            assert langwatch.get_endpoint() == "https://app.langwatch.ai"
            assert f"{langwatch.get_endpoint()}/api/experiment/init" == (
                "https://app.langwatch.ai/api/experiment/init"
            )
        finally:
            Client.reset_for_testing()
