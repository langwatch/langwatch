"""
Unit tests for prompt tag support.

Tests validation logic that does not require API interaction.
"""
import pytest
from unittest.mock import Mock

from langwatch.prompts.prompt_facade import PromptsFacade
from langwatch.prompts.types import FetchPolicy


@pytest.mark.unit
class TestGetTagValidation:
    """Unit tests for tag validation in get()."""

    def _make_facade(self):
        mock_client = Mock()
        return PromptsFacade(mock_client)

    class TestWhenBothVersionAndTagProvided:
        """Scenario: Providing both version and tag raises an error."""

        def test_raises_value_error_before_api_call(self):
            mock_client = Mock()
            facade = PromptsFacade(mock_client)
            facade._api_service.get = Mock()

            with pytest.raises(ValueError, match="Cannot specify both"):
                facade.get("pizza-prompt", version_number=3, tag="production")

            facade._api_service.get.assert_not_called()

    class TestWhenTagWithMaterializedOnly:
        """Scenario: Tag with MATERIALIZED_ONLY raises an error."""

        def test_raises_value_error_indicating_api_required(self):
            mock_client = Mock()
            facade = PromptsFacade(mock_client)

            with pytest.raises(ValueError, match="Tag-based fetch requires API access"):
                facade.get(
                    "pizza-prompt",
                    tag="production",
                    fetch_policy=FetchPolicy.MATERIALIZED_ONLY,
                )
