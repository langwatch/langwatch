import json
import math
import pytest
from langwatch.utils.transformation import (
    truncate_object_recursively,
    _DEFAULT_MAX_PAYLOAD_BYTES,
    SerializableWithStringFallback,
    _sanitize_nan,
)


class TestTruncateObjectRecursively:
    """Test cases for the truncate_object_recursively size-validation function.

    The function no longer truncates: it returns objects unchanged and emits
    a warning when they exceed the size limit.
    """

    def test_no_validation_when_max_string_length_is_none(self):
        """When max_string_length is None the object passes through unchanged."""
        obj = {
            "long_string": "a" * 1000,
            "list": [1, 2, 3] * 100,
            "nested": {"deep": "b" * 500},
        }
        result = truncate_object_recursively(obj, max_string_length=None)
        assert result is obj

    def test_returns_object_unchanged_when_within_limit(self):
        """Objects whose serialized size is within the limit are returned as-is."""
        obj = {"key": "value", "number": 42, "list": [1, 2, 3]}
        result = truncate_object_recursively(obj, max_string_length=10_000)
        assert result is obj

    def test_warns_when_object_exceeds_limit(self):
        """A UserWarning is emitted when the serialized object exceeds the limit."""
        large_string = "x" * 10_000
        with pytest.warns(UserWarning, match="Span input/output too large"):
            result = truncate_object_recursively(large_string, max_string_length=5_000)
        assert result is large_string

    def test_warning_message_contains_sizes(self):
        """The warning message reports both actual and maximum sizes in MB."""
        large_obj = {"data": "a" * (2 * 1024 * 1024)}  # ~2 MB of data
        with pytest.warns(UserWarning, match=r"\d+\.\d+MB.*Maximum allowed is \d+\.\d+MB"):
            result = truncate_object_recursively(large_obj, max_string_length=1 * 1024 * 1024)
        assert result is large_obj

    def test_default_max_payload_bytes_constant(self):
        """The default constant is 10 MB."""
        assert _DEFAULT_MAX_PAYLOAD_BYTES == 10 * 1024 * 1024

    def test_string_within_limit_passes_through_unchanged(self):
        """Strings smaller than the limit are returned without modification."""
        text = "a" * 200
        result = truncate_object_recursively(text, max_string_length=1_000)
        assert result == text

    def test_utf8_string_size_is_measured_in_bytes(self):
        """Multi-byte UTF-8 characters are counted by byte length, not char length."""
        # Each emoji is 4 bytes in UTF-8; 300 emojis = 1200 bytes raw.
        # json.dumps adds surrounding quotes and escapes each emoji to
        # \\uXXXX\\uXXXX (12 chars each), so serialized size is much larger.
        emoji_string = "\U0001f680" * 300
        serialized_size = len(json.dumps(emoji_string).encode("utf-8"))

        # Limit smaller than serialized size should warn
        with pytest.warns(UserWarning, match="Span input/output too large"):
            result_over = truncate_object_recursively(emoji_string, max_string_length=serialized_size - 1)
        assert result_over == emoji_string

        # Limit equal to serialized size should pass it
        result = truncate_object_recursively(emoji_string, max_string_length=serialized_size)
        assert result == emoji_string

    def test_chat_messages_pass_through_unchanged(self):
        """ChatMessage-shaped lists pass through regardless of size."""
        chat_messages = [
            {"role": "user", "content": "Hello " + "x" * 10_000},
            {"role": "assistant", "content": "Hi there " + "y" * 10_000},
        ]
        # Even with a small limit, the object is returned unchanged because
        # the function no longer truncates — it validates total size.
        # With a limit large enough for the serialized payload it passes.
        serialized_size = len(json.dumps(chat_messages).encode("utf-8"))
        result = truncate_object_recursively(
            chat_messages, max_string_length=serialized_size + 1000
        )
        assert result == chat_messages

    def test_nested_object_passes_through_unchanged(self):
        """Nested structures are returned unchanged when within the limit."""
        nested_obj = {
            "level1": {
                "text": "y" * 500,
                "number": 42,
            }
        }
        result = truncate_object_recursively(nested_obj, max_string_length=10_000)
        assert result == nested_obj
        assert result["level1"]["text"] == "y" * 500
        assert result["level1"]["number"] == 42

    def test_mixed_data_types_pass_through_unchanged(self):
        """Mixed-type objects are returned unchanged when within the limit."""
        mixed_obj = {
            "string": "a" * 300,
            "number": 42,
            "boolean": True,
            "null": None,
            "list": [{"nested_string": "b" * 200}, ["c" * 100, "d" * 100], 123],
            "nested_dict": {"inner": "e" * 400},
        }
        result = truncate_object_recursively(mixed_obj, max_string_length=100_000)
        assert result == mixed_obj

    def test_empty_containers_pass_through(self):
        """Empty lists and dicts pass through unchanged."""
        empty_obj = {"empty_list": [], "empty_dict": {}, "empty_string": ""}
        result = truncate_object_recursively(empty_obj, max_string_length=1_000)
        assert result == empty_obj

    def test_max_list_dict_length_is_ignored(self):
        """The max_list_dict_length parameter is accepted but ignored."""
        large_list = [f"item_{i}" for i in range(1000)]
        serialized_size = len(json.dumps(large_list).encode("utf-8"))
        result = truncate_object_recursively(
            large_list,
            max_string_length=serialized_size + 1000,
            max_list_dict_length=100,  # Would have triggered old truncation
        )
        assert len(result) == len(large_list)

    def test_depth_parameter_is_ignored(self):
        """The depth parameter is accepted but ignored."""
        obj = {"key": "value"}
        result = truncate_object_recursively(obj, max_string_length=10_000, depth=5)
        assert result == obj

    def test_non_serializable_object_passes_through(self):
        """Objects that fail serialization entirely are returned unchanged.

        Note: SerializableWithStringFallback falls back to str() for most
        objects, so we need to trigger an actual encoder failure. We do this
        by causing an OverflowError via a deeply recursive structure.
        """
        import sys

        # Create a circular reference which json.dumps will fail on
        a: dict = {}
        a["self"] = a
        result = truncate_object_recursively(a, max_string_length=100)
        assert result is a


class TestWorkflowResultTruncation:
    """Test that workflow results preserve end node data.

    Since truncation is removed, all data passes through unchanged as long
    as it is within the size limit.
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

        serialized_size = len(
            json.dumps(workflow_result, cls=SerializableWithStringFallback).encode("utf-8")
        )
        result = truncate_object_recursively(
            workflow_result,
            max_string_length=serialized_size + 1000,
        )

        assert "end" in result
        assert result["end"]["answer"] == "The capital of France is Paris."
        assert result["end"]["passed"] is True
        assert result == workflow_result

    def test_end_key_preserved_when_workflow_result_nested(self):
        """Nested workflow results are no longer truncated; 'end' key survives."""
        workflow_result = {
            "node_1": {"output": "a" * 30000},
            "node_2": {"output": "b" * 30000},
            "end": {"result": "final answer"},
        }

        wrapper = {"workflow_output": workflow_result}
        serialized_size = len(
            json.dumps(wrapper, cls=SerializableWithStringFallback).encode("utf-8")
        )
        result = truncate_object_recursively(
            wrapper,
            max_string_length=serialized_size + 1000,
        )

        inner = result["workflow_output"]
        assert "end" in inner
        assert inner["end"]["result"] == "final answer"

    def test_end_key_preserved_in_list_valued_outputs(self):
        """List-based workflow outputs preserve the 'end' entry."""
        outputs_list = [
            {"node": "generate", "output": "x" * 30000},
            {"node": "retrieve", "output": "y" * 30000},
            {"node": "end", "output": "final answer"},
        ]

        serialized_size = len(
            json.dumps(outputs_list, cls=SerializableWithStringFallback).encode("utf-8")
        )
        result = truncate_object_recursively(
            outputs_list,
            max_string_length=serialized_size + 1000,
        )

        end_entries = [
            item for item in result if isinstance(item, dict) and item.get("node") == "end"
        ]
        assert len(end_entries) == 1
        assert end_entries[0]["output"] == "final answer"


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
        assert _sanitize_nan("hello") == "hello"
        assert _sanitize_nan(42) == 42
        assert _sanitize_nan(True) is True
        assert _sanitize_nan(None) is None

    def test_sanitizes_nan_in_dict(self):
        result = _sanitize_nan({"a": float("nan"), "b": 1.0, "c": "text"})
        assert result == {"a": None, "b": 1.0, "c": "text"}

    def test_sanitizes_nan_in_list(self):
        result = _sanitize_nan([float("nan"), 1.0, "text"])
        assert result == [None, 1.0, "text"]

    def test_sanitizes_nan_in_nested_structures(self):
        result = _sanitize_nan({
            "outer": {
                "inner": [float("nan"), {"deep": float("inf")}],
                "ok": 1.0,
            }
        })
        assert result == {
            "outer": {
                "inner": [None, {"deep": None}],
                "ok": 1.0,
            }
        }

    def test_sanitizes_nan_in_tuple(self):
        result = _sanitize_nan((float("nan"), 1.0))
        assert result == [None, 1.0]


class TestSerializableWithStringFallbackNan:
    """Test that SerializableWithStringFallback produces valid JSON for NaN/Inf values.

    This is the root cause of issue #1557: pandas DataFrames with missing values
    produce float('nan') which json.dumps outputs as bare NaN -- invalid JSON.
    """

    def test_nan_serialized_as_null(self):
        result = json.dumps({"x": float("nan")}, cls=SerializableWithStringFallback)
        assert result == '{"x": null}'
        # Verify it round-trips as valid JSON
        parsed = json.loads(result)
        assert parsed == {"x": None}

    def test_inf_serialized_as_null(self):
        result = json.dumps({"x": float("inf")}, cls=SerializableWithStringFallback)
        assert result == '{"x": null}'

    def test_negative_inf_serialized_as_null(self):
        result = json.dumps({"x": float("-inf")}, cls=SerializableWithStringFallback)
        assert result == '{"x": null}'

    def test_normal_floats_preserved(self):
        result = json.dumps({"x": 3.14}, cls=SerializableWithStringFallback)
        assert json.loads(result) == {"x": 3.14}

    def test_pandas_nan_in_batch_payload(self):
        """Simulates the exact payload shape from evaluation.log() with pandas NaN values."""
        payload = {
            "experiment_slug": "test-experiment",
            "run_id": "test-run",
            "dataset": [
                {
                    "index": 0,
                    "entry": {
                        "input": "question",
                        "expected_output": float("nan"),  # pandas None -> NaN
                        "extra_col": float("nan"),
                    },
                    "duration": 100,
                    "trace_id": "abc123",
                }
            ],
            "evaluations": [
                {
                    "evaluator": "test",
                    "status": "processed",
                    "index": 0,
                    "score": 0.85,
                    "inputs": {
                        "input": "question",
                        "output": "answer",
                        "expected_output": float("nan"),
                    },
                }
            ],
        }

        result = json.dumps(payload, cls=SerializableWithStringFallback)
        # Must be valid JSON
        parsed = json.loads(result)
        assert parsed["dataset"][0]["entry"]["expected_output"] is None
        assert parsed["dataset"][0]["entry"]["extra_col"] is None
        assert parsed["evaluations"][0]["inputs"]["expected_output"] is None

    def test_nan_inside_pydantic_model(self):
        """NaN values inside Pydantic models (going through default()) are sanitized."""
        from pydantic import BaseModel

        class Score(BaseModel):
            value: float
            label: str

        result = json.dumps(
            {"score": Score(value=float("nan"), label="test")},
            cls=SerializableWithStringFallback,
        )
        parsed = json.loads(result)
        assert parsed["score"]["value"] is None
        assert parsed["score"]["label"] == "test"

    def test_nan_inside_set(self):
        """NaN values inside sets (going through default()) are sanitized."""
        result = json.dumps(
            {"values": {1.0, float("nan"), 2.0}},
            cls=SerializableWithStringFallback,
        )
        parsed = json.loads(result)
        assert None in parsed["values"]

    def test_json_dump_file_also_sanitizes_nan(self):
        """json.dump() (file writer path) also sanitizes NaN via iterencode()."""
        import io

        buf = io.StringIO()
        json.dump({"x": float("nan")}, buf, cls=SerializableWithStringFallback)
        assert json.loads(buf.getvalue()) == {"x": None}
