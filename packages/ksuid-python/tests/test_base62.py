"""Tests for base62 encoding and decoding."""

import pytest

from ksuid.base62 import decode, encode
from ksuid.errors import Base62Error


class TestBase62:
    """Test base62 encoding and decoding functions."""

    def test_encode_empty_bytes(self):
        """Test encoding empty bytes."""
        result = encode(b"")
        assert result == ""

    def test_encode_zero(self):
        """Test encoding zero."""
        result = encode(bytes([0]))
        assert result == "0"

    def test_encode_single_byte(self):
        """Test encoding single byte values."""
        assert encode(bytes([1])) == "1"
        assert encode(bytes([10])) == "A"
        assert encode(bytes([36])) == "a"
        assert encode(bytes([61])) == "z"

    def test_encode_multiple_bytes(self):
        """Test encoding multiple byte values."""
        # Test with known values - these match the JavaScript implementation
        assert encode(bytes([1, 2, 3])) == "HBL"
        assert encode(bytes([255, 255, 255, 255])) == "4gfFC3"

    def test_encode_large_number(self):
        """Test encoding large numbers."""
        # Test with a large number
        large_bytes = bytes([255, 255, 255, 255, 255, 255, 255, 255])
        result = encode(large_bytes)
        assert len(result) > 0
        assert all(
            c in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
            for c in result
        )

    def test_decode_empty_string(self):
        """Test decoding empty string."""
        result = decode("")
        assert result == b""

    def test_decode_zero(self):
        """Test decoding zero."""
        result = decode("0")
        assert result == bytes([0])

    def test_decode_single_char(self):
        """Test decoding single characters."""
        assert decode("1") == bytes([1])
        assert decode("A") == bytes([10])
        assert decode("a") == bytes([36])
        assert decode("z") == bytes([61])

    def test_decode_multiple_chars(self):
        """Test decoding multiple characters."""
        # Test with known values - these match the JavaScript implementation
        assert decode("HBL") == bytes([1, 2, 3])
        assert decode("4gfFC3") == bytes([255, 255, 255, 255])

    def test_decode_invalid_characters(self):
        """Test decoding with invalid characters."""
        with pytest.raises(Base62Error, match="Invalid character in base62 string"):
            decode("1A2B3C!")

        with pytest.raises(Base62Error, match="Invalid character in base62 string"):
            decode("1A2B3C@")

        with pytest.raises(Base62Error, match="Invalid character in base62 string"):
            decode("1A2B3C#")

    def test_encode_decode_roundtrip(self):
        """Test that encode and decode are inverse operations."""
        test_cases = [
            bytes([1, 2, 3, 4, 5]),
            bytes([255, 255, 255, 255]),
            bytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
            bytes([10, 20, 30, 40, 50]),
            bytes([100, 200, 255]),
        ]

        for test_bytes in test_cases:
            encoded = encode(test_bytes)
            decoded = decode(encoded, len(test_bytes))
            assert decoded == test_bytes

    def test_encode_decode_edge_cases(self):
        """Test edge cases for encode and decode."""
        # Test with all zeros
        zeros = bytes([0, 0, 0, 0])
        encoded = encode(zeros)
        decoded = decode(encoded, len(zeros))
        assert decoded == zeros

        # Test with all ones
        ones = bytes([1, 1, 1, 1])
        encoded = encode(ones)
        decoded = decode(encoded)
        assert decoded == ones

        # Test with alternating bytes
        alternating = bytes([1, 0, 1, 0, 1, 0])
        encoded = encode(alternating)
        decoded = decode(encoded)
        assert decoded == alternating

    def test_encode_decode_large_data(self):
        """Test with larger data sets."""
        # Test with 21 bytes (KSUID payload size)
        large_data = bytes(range(21))
        encoded = encode(large_data)
        decoded = decode(encoded, len(large_data))
        assert decoded == large_data

        # Test with 100 bytes
        very_large_data = bytes(range(100))
        encoded = encode(very_large_data)
        decoded = decode(encoded, len(very_large_data))
        assert decoded == very_large_data
