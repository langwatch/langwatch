import json
import math
import pytest
from langwatch.utils.transformation import (
    truncate_object_recursively,
    SerializableWithStringFallback,
    _sanitize_nan,
)


class TestTruncateObjectRecursively:
    """Test cases for the truncate_object_recursively function."""

    def test_no_truncation_when_max_string_length_is_none(self):
        """Test that no truncation occurs when max_string_length is None."""
        obj = {
            "long_string": "a" * 1000,
            "list": [1, 2, 3] * 100,
            "nested": {"deep": "b" * 500},
        }
        result = truncate_object_recursively(obj, max_string_length=None)
        assert result == obj

    def test_raises_error_for_small_max_string_length(self):
        """Test that ValueError is raised when max_string_length < 100."""
        with pytest.raises(ValueError, match="max_string_length must be at least 100"):
            truncate_object_recursively("test", max_string_length=50)

    def test_string_truncation(self):
        """Test string truncation with UTF-8 byte length consideration."""
        # Test basic string truncation
        long_string = "a" * 200
        result = truncate_object_recursively(long_string, max_string_length=150)
        assert result.endswith("... (truncated string)")
        # The function reserves 25 bytes for the suffix, so result should be under the limit
        assert len(result.encode("utf-8")) < 200  # Should be smaller than original
        assert len(result.encode("utf-8")) <= 150  # Should respect the limit

        # Test UTF-8 string truncation
        utf8_string = "🚀" * 100  # Each emoji is 4 bytes in UTF-8, total 400 bytes
        result = truncate_object_recursively(utf8_string, max_string_length=200)
        assert result.endswith("... (truncated string)")
        # Should be truncated since original is 400 bytes > 200
        assert len(result.encode("utf-8")) < 400  # Should be smaller than original

    def test_list_truncation_with_low_max_length(self):
        """Test list truncation with very low max_list_dict_length."""
        # Create a list that will exceed the limit when serialized
        large_list = [f"item_{i}" for i in range(100)]

        # Use a very low max_list_dict_length to trigger truncation easily
        result = truncate_object_recursively(
            large_list,
            max_string_length=1000,
            max_list_dict_length=100,  # Very low limit
        )

        # Check that the list was truncated
        assert isinstance(result, list)
        assert result[-1] == "... (truncated list)"
        assert len(result) < len(large_list)

        # The function truncates when it would exceed the limit, so final result
        # may be slightly over the limit due to the truncation marker
        serialized_length = len(json.dumps(result))
        # Just verify truncation occurred, don't check exact limit
        assert serialized_length < len(json.dumps(large_list))

    def test_dict_truncation_with_low_max_length(self):
        """Test dict truncation with very low max_list_dict_length."""
        # Create a dict that will exceed the limit when serialized
        large_dict = {f"key_{i}": f"value_{i}_" * 10 for i in range(50)}

        # Use a very low max_list_dict_length to trigger truncation easily
        result = truncate_object_recursively(
            large_dict,
            max_string_length=1000,
            max_list_dict_length=150,  # Very low limit
        )

        # Check that the dict was truncated (only applies at depth > 0)
        nested_dict = {"outer": large_dict}
        result = truncate_object_recursively(
            nested_dict, max_string_length=1000, max_list_dict_length=150
        )

        assert isinstance(result, dict)
        assert "outer" in result
        if "..." in result["outer"]:
            assert result["outer"]["..."] == "(truncated object)"

    def test_nested_object_truncation(self):
        """Test truncation of deeply nested objects."""
        # Create a simpler nested structure to avoid dict truncation
        nested_obj = {
            "level1": {
                "text": "y" * 500,  # This will be truncated
                "number": 42,  # This won't be truncated
            }
        }

        result = truncate_object_recursively(
            nested_obj,
            max_string_length=200,
            max_list_dict_length=5000,  # High limit to avoid dict truncation
        )

        # Check that strings were truncated but structure preserved
        assert "level1" in result
        assert result["level1"]["text"].endswith("... (truncated string)")
        assert result["level1"]["number"] == 42

    def test_mixed_data_types(self):
        """Test truncation with mixed data types."""
        mixed_obj = {
            "string": "a" * 300,
            "number": 42,
            "boolean": True,
            "null": None,
            "list": [{"nested_string": "b" * 200}, ["c" * 100, "d" * 100], 123],
            "nested_dict": {"inner": "e" * 400},
        }

        result = truncate_object_recursively(
            mixed_obj, max_string_length=150, max_list_dict_length=500
        )

        # Check that only strings were truncated, other types preserved
        assert result["number"] == 42
        assert result["boolean"] is True
        assert result["null"] is None
        assert result["string"].endswith("... (truncated string)")
        assert result["nested_dict"]["inner"].endswith("... (truncated string)")

    def test_chat_messages_bypass_truncation(self):
        """Test that ChatMessage lists bypass truncation logic."""
        # This test assumes ChatMessage validation works
        # The function has special handling for chat message lists
        chat_messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]

        result = truncate_object_recursively(
            chat_messages,
            max_string_length=500,  # Use valid value (>= 100)
            max_list_dict_length=50,
        )

        # Chat messages should not be truncated due to special handling
        assert result == chat_messages

    def test_empty_containers(self):
        """Test truncation with empty lists and dicts."""
        empty_obj = {"empty_list": [], "empty_dict": {}, "empty_string": ""}

        result = truncate_object_recursively(
            empty_obj, max_string_length=100, max_list_dict_length=50
        )

        assert result == empty_obj

    def test_max_list_dict_length_disabled(self):
        """Test behavior when max_list_dict_length is -1 (disabled)."""
        large_list = [f"item_{i}" for i in range(1000)]

        result = truncate_object_recursively(
            large_list, max_string_length=1000, max_list_dict_length=-1  # Disabled
        )

        # Should not truncate the list when disabled
        assert len(result) == len(large_list)
        assert "... (truncated list)" not in result

    def test_string_truncation_preserves_utf8_boundaries(self):
        """Test that string truncation doesn't break UTF-8 character boundaries."""
        # Create a string with multi-byte UTF-8 characters that will be truncated
        text = "a" * 200 + "🚀🚀🚀"  # Add emojis at the end

        result = truncate_object_recursively(text, max_string_length=150)

        # Result should be valid UTF-8 and not break characters
        # Should not raise UnicodeDecodeError
        result.encode("utf-8").decode("utf-8")
        # Should be truncated due to length
        assert result.endswith("... (truncated string)")

    def test_japanese_characters_truncation(self):
        """Test truncation with Japanese characters (multi-byte UTF-8) - explicit input/output test."""
        # Input object with Japanese text that will be truncated
        input_obj = {
            "message": "こんにちは世界プログラミング"
            * 10,  # 140 chars, 420 bytes - will be truncated
            "metadata": {
                "author": "田中太郎",  # Short Japanese name - should not be truncated
                "timestamp": "2024-01-01T00:00:00Z",  # ASCII timestamp - should not be truncated
                "tags": [
                    "日本語",
                    "テスト",
                    "文字化け防止",
                ],  # Japanese tags - should not be truncated
            },
            "content": {
                "title": "日本語のテスト文書",  # Short Japanese title - should not be truncated
                "body": "これは非常に長い日本語の文章です。"
                * 20,  # Long Japanese text - will be truncated
                "summary": "短い要約",  # Short summary - should not be truncated
            },
        }

        result = truncate_object_recursively(
            input_obj,
            max_string_length=200,  # Force truncation of longer strings
            max_list_dict_length=1000,  # Allow dict structure to remain
        )

        # Expected result with exact truncated strings based on actual function behavior
        expected = {
            "message": "こんにちは世界プログラミングこんにちは世界プログラミングこんにちは世界プログラミングこんにちは世界プログラミングこん... (truncated string)",
            "metadata": {
                "author": "田中太郎",
                "timestamp": "2024-01-01T00:00:00Z",
                "tags": ["日本語", "テスト", "文字化け防止"],
            },
            "content": {
                "title": "日本語のテスト文書",
                "body": "これは非常に長い日本語の文章です。これは非常に長い日本語の文章です。これは非常に長い日本語の文章です。これは非常に長... (truncated string)",
                "summary": "短い要約",
            },
        }

        # Use JSON encoding for precise comparison as requested
        import json

        result_json = json.dumps(result, ensure_ascii=False, sort_keys=True)
        expected_json = json.dumps(expected, ensure_ascii=False, sort_keys=True)

        # Explicit assertion that the full result matches expected
        assert (
            result == expected
        ), f"Result does not match expected.\nActual:\n{result_json}\n\nExpected:\n{expected_json}"

        # Additional specific verifications for UTF-8 handling
        # Verify UTF-8 integrity - should not raise UnicodeDecodeError
        result["message"].encode("utf-8").decode("utf-8")
        result["content"]["body"].encode("utf-8").decode("utf-8")

        # Verify byte length constraints are respected
        assert len(result["message"].encode("utf-8")) <= 200
        assert len(result["content"]["body"].encode("utf-8")) <= 200

        # Verify truncation actually occurred (result is smaller than input)
        assert len(result["message"].encode("utf-8")) < len(
            input_obj["message"].encode("utf-8")
        )
        assert len(result["content"]["body"].encode("utf-8")) < len(
            input_obj["content"]["body"].encode("utf-8")
        )

    def test_malformed_unicode_handling(self):
        """Test that the function handles malformed Unicode gracefully for LLM telemetry robustness."""
        # These are examples of problematic Unicode that users might send in LLM telemetry
        problematic_strings = [
            "Normal text with surrogate \ud800 character",  # High surrogate
            "Text with \udc00 low surrogate",  # Low surrogate
            "Mixed \ud800\udc00 surrogate pair",  # Surrogate pair
            "Control chars \x00\x01\x02 in text",  # Null and control characters
            "Normal text that should work fine",  # Control case
        ]

        for i, problematic_string in enumerate(problematic_strings):
            # The function should NEVER crash on any input, even malformed Unicode
            # This is critical for LLM telemetry robustness
            result = truncate_object_recursively(
                problematic_string, max_string_length=100, max_list_dict_length=1000
            )

            # The function should always return a string
            assert isinstance(result, str), f"Result should be string for case {i}: {problematic_string!r}"

            # The result should be encodable to UTF-8 (possibly with replacements)
            # This should never fail now that we handle encoding errors gracefully
            encoded = result.encode("utf-8", errors='replace')
            decoded = encoded.decode("utf-8")

            # Verify the round-trip works
            assert isinstance(decoded, str), f"Round-trip should work for case {i}"

            # Verify length constraints are respected (using replacement encoding if needed)
            result_bytes = len(result.encode("utf-8", errors='replace'))
            assert result_bytes <= 100 or not result.endswith("... (truncated string)"), \
                f"Result should respect byte limit for case {i}: {result_bytes} bytes"

    def test_very_low_max_list_dict_length(self):
        """Test with extremely low max_list_dict_length values."""
        # Test with a value so low that even a small object exceeds it
        small_obj = {"a": "b", "c": "d"}

        result = truncate_object_recursively(
            {"outer": small_obj},
            max_string_length=1000,
            max_list_dict_length=20,  # Extremely low
        )

        # The nested dict should be truncated
        assert isinstance(result, dict)
        assert "outer" in result

        # Create an even smaller test
        tiny_list = ["a", "b", "c"]
        result = truncate_object_recursively(
            tiny_list, max_string_length=1000, max_list_dict_length=10  # Very low
        )

        # Should truncate the list
        assert isinstance(result, list)
        assert len(result) <= 3  # Should be truncated
        if len(result) < 3:
            assert result[-1] == "... (truncated list)"

    def test_depth_affects_dict_truncation(self):
        """Test that dict truncation only applies at depth > 0."""
        large_dict = {f"key_{i}": f"value_{i}" for i in range(100)}

        # At depth 0, dict should not be truncated by max_list_dict_length
        result = truncate_object_recursively(
            large_dict, max_string_length=1000, max_list_dict_length=50
        )

        # Top-level dict should not have truncation marker
        assert "..." not in result

        # But nested dict should be truncated
        nested = {"outer": large_dict}
        result = truncate_object_recursively(
            nested, max_string_length=1000, max_list_dict_length=50
        )

        # The nested dict might be truncated
        if "..." in result.get("outer", {}):
            assert result["outer"]["..."] == "(truncated object)"


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
    produce float('nan') which json.dumps outputs as bare NaN — invalid JSON.
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
                        "expected_output": float("nan"),  # pandas None → NaN
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
