"""Base62 encoding and decoding utilities."""

from .errors import Base62Error

# Base62 alphabet: 0-9, A-Z, a-z
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
ALPHABET_LENGTH = len(ALPHABET)

# Create lookup tables for faster encoding/decoding
ENCODE_LOOKUP = {char: i for i, char in enumerate(ALPHABET)}
DECODE_LOOKUP = dict(enumerate(ALPHABET))


def encode(input_bytes: bytes) -> str:
    """
    Encodes a byte array to base62 string.

    Args:
        input_bytes: The byte array to encode

    Returns:
        Base62 encoded string

    Example:
        >>> bytes_data = bytes([1, 2, 3, 4])
        >>> encoded = encode(bytes_data)  # '1A2B3C'
    """
    if len(input_bytes) == 0:
        return ""

    # Convert to int using bitwise operations like JavaScript
    # This matches the JS: (num << 8n) | BigInt(input[i])
    num = 0
    for byte in input_bytes:
        num = (num << 8) | byte

    if num == 0:
        return "0"

    result: list[str] = []

    while num > 0:
        remainder = num % ALPHABET_LENGTH
        result.insert(0, DECODE_LOOKUP[remainder])
        num = num // ALPHABET_LENGTH

    return "".join(result)


def decode(input_str: str, expected_length: int = 0) -> bytes:
    """
    Decodes a base62 string to byte array.

    Args:
        input_str: The base62 string to decode
        expected_length: Expected length of the result (for padding with zeros)

    Returns:
        Decoded byte array

    Raises:
        Base62Error: If the input contains invalid characters

    Example:
        >>> decoded = decode('1A2B3C')  # bytes([1, 2, 3, 4])
    """
    if len(input_str) == 0:
        return b""

    # Validate input
    for char in input_str:
        if char not in ENCODE_LOOKUP:
            raise Base62Error("Invalid character in base62 string")

    num = 0

    for char in input_str:
        value = ENCODE_LOOKUP[char]
        num = num * ALPHABET_LENGTH + value

    if num == 0:
        return bytes([0] * max(1, expected_length))

    # Convert int back to bytes
    # Calculate the number of bytes needed
    byte_length = (num.bit_length() + 7) // 8
    result = num.to_bytes(byte_length, byteorder="big")

    # Pad with leading zeros if needed
    if expected_length > 0 and len(result) < expected_length:
        result = bytes([0] * (expected_length - len(result))) + result

    return result
