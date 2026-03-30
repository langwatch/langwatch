"""
Unit tests for prompt label support.

Tests validation logic that does not require API interaction.
"""
import pytest
from unittest.mock import Mock

from langwatch.prompts.prompt_facade import PromptsFacade
from langwatch.prompts.types import FetchPolicy


class TestGetLabelValidation:
    """Unit tests for label validation in get()."""

    def _make_facade(self):
        mock_client = Mock()
        return PromptsFacade(mock_client)

    class TestWhenBothVersionAndLabelProvided:
        """Scenario: Providing both version and label raises an error."""

        def test_raises_value_error_before_api_call(self):
            mock_client = Mock()
            facade = PromptsFacade(mock_client)
            facade._api_service.get = Mock()

            with pytest.raises(ValueError, match="Cannot specify both"):
                facade.get("pizza-prompt", version_number=3, label="production")

            facade._api_service.get.assert_not_called()

    class TestWhenInvalidLabelProvided:
        """Scenario: Invalid label value raises an error at runtime."""

        def test_raises_value_error_for_canary_label(self):
            mock_client = Mock()
            facade = PromptsFacade(mock_client)
            facade._api_service.get = Mock()

            with pytest.raises(ValueError, match="Invalid label"):
                facade.get("pizza-prompt", label="canary")

            facade._api_service.get.assert_not_called()

        def test_raises_value_error_for_empty_string_label(self):
            mock_client = Mock()
            facade = PromptsFacade(mock_client)
            facade._api_service.get = Mock()

            with pytest.raises(ValueError, match="Invalid label"):
                facade.get("pizza-prompt", label="")

    class TestWhenLabelWithMaterializedOnly:
        """Scenario: Label with MATERIALIZED_ONLY raises an error."""

        def test_raises_value_error_indicating_api_required(self):
            mock_client = Mock()
            facade = PromptsFacade(mock_client)

            with pytest.raises(ValueError, match="Label-based fetch requires API access"):
                facade.get(
                    "pizza-prompt",
                    label="production",
                    fetch_policy=FetchPolicy.MATERIALIZED_ONLY,
                )
