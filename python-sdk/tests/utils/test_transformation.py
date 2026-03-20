import json
import math
import pytest
from langwatch.utils.transformation import (
    SerializableWithStringFallback,
    _sanitize_nan,
)


class TestSanitizeNan:
    """Test cases for _sanitize_nan and NaN handling in SerializableWithStringFallback."""

    def test_replaces_nan_with_none(self):
        assert _sanitize_nan(float("nan")) is None

    def test_replaces_positive_inf_with_none(self):
        assert _sanitize_nan(float("inf")) is None

    def test_replaces_negative_inf_with_none(self):
        assert _sanitize_nan(float("-inf")) is None

    def test_preserves_normal_floats(self):
        assert _sanitize_nan(3.14) == 3.14
        assert _sanitize_nan(0.0) == 0.0
        assert _sanitize_nan(-1.5) == -1.5

    def test_preserves_non_float_types(self):
        assert _sanitize_nan(42) == 42
        assert _sanitize_nan("hello") == "hello"
        assert _sanitize_nan(None) is None
        assert _sanitize_nan(True) is True

    def test_sanitizes_nan_in_dict(self):
        obj = {"a": float("nan"), "b": 1.0, "c": float("inf")}
        result = _sanitize_nan(obj)
        assert result == {"a": None, "b": 1.0, "c": None}

    def test_sanitizes_nan_in_list(self):
        obj = [float("nan"), 1.0, float("-inf"), "hello"]
        result = _sanitize_nan(obj)
        assert result == [None, 1.0, None, "hello"]

    def test_sanitizes_nan_in_nested_structures(self):
        obj = {"list": [float("nan"), {"inner": float("inf")}], "value": 42}
        result = _sanitize_nan(obj)
        assert result == {"list": [None, {"inner": None}], "value": 42}

    def test_sanitizes_nan_in_tuple(self):
        obj = (float("nan"), 1.0, float("inf"))
        result = _sanitize_nan(obj)
        assert result == [None, 1.0, None]


class TestSerializableWithStringFallbackNan:
    """Test NaN handling in SerializableWithStringFallback JSON encoder."""

    def test_nan_serialized_as_null(self):
        result = json.dumps({"value": float("nan")}, cls=SerializableWithStringFallback)
        assert result == '{"value": null}'

    def test_inf_serialized_as_null(self):
        result = json.dumps({"value": float("inf")}, cls=SerializableWithStringFallback)
        assert result == '{"value": null}'

    def test_negative_inf_serialized_as_null(self):
        result = json.dumps({"value": float("-inf")}, cls=SerializableWithStringFallback)
        assert result == '{"value": null}'

    def test_normal_floats_preserved(self):
        result = json.dumps({"value": 3.14}, cls=SerializableWithStringFallback)
        assert '"value": 3.14' in result

    def test_pandas_nan_in_batch_payload(self):
        """Simulate pandas NaN values in a batch evaluation payload."""
        batch_results = [
            {"score": 0.85, "details": "good"},
            {"score": float("nan"), "details": None},
            {"score": float("inf"), "details": "overflow"},
        ]
        result = json.loads(json.dumps(batch_results, cls=SerializableWithStringFallback))
        assert result[0]["score"] == 0.85
        assert result[1]["score"] is None
        assert result[2]["score"] is None

    def test_nan_inside_pydantic_model(self):
        """Pydantic models with NaN fields are serialized with null."""
        from pydantic import BaseModel

        class Result(BaseModel):
            score: float
            label: str

        model = Result(score=float("nan"), label="test")
        result = json.loads(json.dumps(model, cls=SerializableWithStringFallback))
        assert result["score"] is None
        assert result["label"] == "test"

    def test_nan_inside_set(self):
        """Sets containing NaN are serialized (sets become lists)."""
        data = {float("nan"), 1.0, 2.0}
        result = json.loads(json.dumps(data, cls=SerializableWithStringFallback))
        assert None in result
        assert 1.0 in result

    def test_json_dump_file_also_sanitizes_nan(self):
        """json.dump to file also sanitizes NaN values."""
        import io

        buf = io.StringIO()
        json.dump({"x": float("nan")}, buf, cls=SerializableWithStringFallback)
        assert json.loads(buf.getvalue()) == {"x": None}
