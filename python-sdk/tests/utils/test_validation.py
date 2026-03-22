"""Unit tests for langwatch.utils.validation."""

import warnings
import pytest
from langwatch.utils.validation import validate_list_param, validate_metadata


class TestValidateListParam:
    """Tests for validate_list_param."""

    def test_returns_none_for_none_input(self):
        result = validate_list_param("contexts", None)
        assert result is None

    def test_returns_list_unchanged(self):
        value = [{"content": "chunk"}]
        result = validate_list_param("contexts", value)
        assert result is value

    def test_returns_empty_list_unchanged(self):
        result = validate_list_param("contexts", [])
        assert result == []

    def test_warns_on_dict_input(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_list_param("contexts", {"content": "chunk"})
        assert result is None
        assert len(caught) == 1
        assert issubclass(caught[0].category, UserWarning)
        assert "contexts" in str(caught[0].message)
        assert "dict" in str(caught[0].message)

    def test_warns_on_string_input(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_list_param("contexts", "raw text chunk")
        assert result is None
        assert len(caught) == 1
        assert "contexts" in str(caught[0].message)
        assert "str" in str(caught[0].message)

    def test_warning_includes_param_name(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            validate_list_param("evaluations", {"name": "eval", "status": "processed"})
        assert "evaluations" in str(caught[0].message)

    def test_warning_includes_example_when_provided(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            validate_list_param("contexts", "bad", example='[{"content": "ok"}]')
        assert '[{"content": "ok"}]' in str(caught[0].message)

    def test_warns_on_tuple_input(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_list_param("contexts", ({"content": "chunk"},))
        assert result is None
        assert len(caught) == 1


class TestValidateMetadata:
    """Tests for validate_metadata."""

    def test_returns_none_for_none_input(self):
        assert validate_metadata(None) is None

    def test_returns_dict_unchanged(self):
        value = {"user_id": "u-1", "labels": ["production"]}
        result = validate_metadata(value)
        assert result == value

    def test_returns_empty_dict_unchanged(self):
        result = validate_metadata({})
        assert result == {}

    def test_warns_on_string_input(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_metadata("bad-metadata")
        assert result is None
        assert len(caught) == 1
        assert issubclass(caught[0].category, UserWarning)
        assert "metadata" in str(caught[0].message)
        assert "str" in str(caught[0].message)

    def test_warns_on_list_input(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_metadata(["key", "value"])
        assert result is None
        assert len(caught) == 1
        assert "metadata" in str(caught[0].message)

    def test_warns_when_labels_is_string(self):
        """metadata['labels'] must be a list, not a string (the core issue example)."""
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_metadata({"user_id": "u-1", "labels": "production"})
        assert result is not None
        assert "labels" not in result
        assert result.get("user_id") == "u-1"
        assert len(caught) == 1
        assert "labels" in str(caught[0].message)
        assert "str" in str(caught[0].message)

    def test_no_warning_when_labels_is_list(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_metadata({"labels": ["production", "v2"]})
        assert result == {"labels": ["production", "v2"]}
        assert len(caught) == 0

    def test_warns_when_labels_is_dict(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_metadata({"labels": {"env": "production"}})
        assert "labels" not in result
        assert len(caught) == 1

    def test_other_metadata_fields_preserved_when_labels_invalid(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = validate_metadata(
                {"user_id": "u-1", "customer_id": "c-1", "labels": "bad"}
            )
        assert result == {"user_id": "u-1", "customer_id": "c-1"}
