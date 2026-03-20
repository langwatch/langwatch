import json
import math
import pytest
from langwatch.utils.transformation import (
    truncate_object_recursively,
    SerializableWithStringFallback,
    _sanitize_nan,
)


class TestTruncateObjectRecursively:
    """truncate_object_recursively is now a no-op that returns obj unchanged.

    It previously truncated large objects, silently replacing dict keys and
    list items with markers like {"...": "(truncated object)"}. That caused
    workflow end-node outputs to be dropped. It now always returns obj as-is.
    """

    def test_returns_object_unchanged(self):
        """Any object is returned as the same identity."""
        obj = {"key": "value", "number": 42, "list": [1, 2, 3]}
        assert truncate_object_recursively(obj) is obj

    def test_ignores_max_string_length(self):
        """The max_string_length parameter is accepted but ignored."""
        large = "x" * 100_000
        assert truncate_object_recursively(large, max_string_length=100) is large

    def test_ignores_max_list_dict_length(self):
        """The max_list_dict_length parameter is accepted but ignored."""
        large_list = [f"item_{i}" for i in range(1000)]
        result = truncate_object_recursively(large_list, max_list_dict_length=10)
        assert result is large_list

    def test_ignores_depth(self):
        """The depth parameter is accepted but ignored."""
        obj = {"key": "value"}
        assert truncate_object_recursively(obj, depth=99) is obj

    def test_none_max_string_length_passes_through(self):
        """Explicitly passing None still returns obj unchanged."""
        obj = {"big": "a" * 50_000}
        assert truncate_object_recursively(obj, max_string_length=None) is obj

    def test_nested_objects_preserved(self):
        """Deeply nested structures are never modified."""
        nested = {"a": {"b": {"c": {"d": "x" * 10_000}}}}
        result = truncate_object_recursively(nested, max_string_length=100)
        assert result is nested
        assert result["a"]["b"]["c"]["d"] == "x" * 10_000

    def test_large_list_preserved(self):
        """Large lists are never truncated."""
        big_list = [{"data": "y" * 5000} for _ in range(100)]
        result = truncate_object_recursively(big_list, max_list_dict_length=50)
        assert result is big_list
        assert len(result) == 100

    def test_chat_messages_preserved(self):
        """ChatMessage-shaped lists pass through unchanged."""
        chat = [
            {"role": "user", "content": "Hello " + "x" * 10_000},
            {"role": "assistant", "content": "Hi " + "y" * 10_000},
        ]
        result = truncate_object_recursively(chat, max_string_length=100)
        assert result is chat

    def test_string_preserved(self):
        """Plain strings are never truncated."""
        s = "a" * 100_000
        result = truncate_object_recursively(s, max_string_length=100)
        assert result is s

    def test_non_serializable_preserved(self):
        """Even non-serializable objects pass through."""
        circular: dict = {}
        circular["self"] = circular
        result = truncate_object_recursively(circular, max_string_length=100)
        assert result is circular


class TestWorkflowResultTruncation:
    """Regression tests: workflow end-node data must never be lost.

    These tests previously FAILED when truncate_object_recursively silently
    dropped dict keys. Now that it's a no-op, they pass trivially.
    """

    def test_end_node_values_survive_when_intermediate_outputs_are_large(self):
        """All workflow result keys, including 'end', are preserved."""
        workflow_result = {
            "generate_answer": {
                "answer": "The capital of France is Paris.",
                "reasoning": "x" * 60000,
                "tool_calls": [
                    {"name": f"tool_{i}", "arguments": "y" * 5000}
                    for i in range(10)
                ],
            },
            "retrieve_context": {
                "documents": [f"doc_{i}: " + "z" * 5000 for i in range(20)],
            },
            "end": {
                "answer": "The capital of France is Paris.",
                "passed": True,
            },
        }

        result = truncate_object_recursively(
            workflow_result, max_string_length=5000, max_list_dict_length=50000,
        )

        assert result is workflow_result
        assert result["end"]["answer"] == "The capital of France is Paris."
        assert result["end"]["passed"] is True

    def test_end_key_preserved_when_workflow_result_nested(self):
        """Nested workflow results preserve all keys including 'end'."""
        workflow_result = {
            "node_1": {"output": "a" * 30000},
            "node_2": {"output": "b" * 30000},
            "end": {"result": "final answer"},
        }
        wrapper = {"workflow_output": workflow_result}

        result = truncate_object_recursively(
            wrapper, max_string_length=5000, max_list_dict_length=50000,
        )

        assert result is wrapper
        assert result["workflow_output"]["end"]["result"] == "final answer"

    def test_end_key_preserved_in_list_valued_outputs(self):
        """End entries in list-valued outputs are preserved."""
        outputs_list = [
            {"node": "generate", "output": "x" * 30000},
            {"node": "retrieve", "output": "y" * 30000},
            {"node": "end", "output": "final answer"},
        ]

        result = truncate_object_recursively(
            outputs_list, max_string_length=50000, max_list_dict_length=50000,
        )

        assert result is outputs_list
        assert len(result) == 3
        assert result[2]["output"] == "final answer"


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
