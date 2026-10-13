"""Input validation functions for the KSUID library."""

from typing import TypeVar

from .constants import PREFIX_REGEX
from .errors import ValidationError

T = TypeVar("T")


def check_prefix(field: str, value: object) -> None:
    """
    Validates that a value is a valid prefix string (lowercase letters and digits only).

    Args:
        field: The field name for error messages
        value: The value to validate

    Raises:
        ValidationError: If the value is not a valid prefix
    """
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string")

    if not PREFIX_REGEX.match(value):
        raise ValidationError(f"{field} contains invalid characters")


def check_uint(field: str, value: object, byte_length: int) -> None:
    """
    Validates that a value is a valid unsigned integer within the specified bit range.

    Args:
        field: The field name for error messages
        value: The value to validate
        byte_length: The number of bytes (determines bit range)

    Raises:
        ValidationError: If the value is not a valid unsigned integer
    """
    if not isinstance(value, int):
        raise ValidationError(f"{field} must be an integer")

    if value < 0:
        raise ValidationError(f"{field} must be positive")

    max_value = (2 ** (byte_length * 8)) - 1
    if value > max_value:
        raise ValidationError(f"{field} must be a uint{byte_length * 8}")


def check_bytes(field: str, value: object, byte_length: int) -> None:
    """
    Validates that a value is a bytes object with the specified length.

    Args:
        field: The field name for error messages
        value: The value to validate
        byte_length: The expected length in bytes

    Raises:
        ValidationError: If the value is not a bytes object with the correct length
    """
    if not isinstance(value, (bytes, bytearray)):
        raise ValidationError(f"{field} must be a bytes object")

    if len(value) != byte_length:
        raise ValidationError(f"{field} must be {byte_length} bytes")


def check_class(field: str, value: object, class_type: type[T]) -> None:
    """
    Validates that a value is an instance of the specified class.

    Args:
        field: The field name for error messages
        value: The value to validate
        class_type: The expected class constructor

    Raises:
        ValidationError: If the value is not an instance of the specified class
    """
    if not isinstance(value, class_type):
        raise ValidationError(f"{field} must be an instance of {class_type.__name__}")


def check_instance(field: str, value: object) -> None:
    """
    Validates that a value is an Instance object.

    Args:
        field: The field name for error messages
        value: The value to validate

    Raises:
        ValidationError: If the value is not an Instance
    """
    # Import here to avoid circular import
    from .instance import Instance

    if not isinstance(value, Instance):
        raise ValidationError(f"{field} must be an instance of Instance")


def check_string(field: str, value: object) -> None:
    """
    Validates that a value is a string.

    Args:
        field: The field name for error messages
        value: The value to validate

    Raises:
        ValidationError: If the value is not a string
    """
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string")


def check_non_empty_string(field: str, value: object) -> None:
    """
    Validates that a value is a non-empty string.

    Args:
        field: The field name for error messages
        value: The value to validate

    Raises:
        ValidationError: If the value is not a non-empty string
    """
    check_string(field, value)
    if len(value) == 0:  # type: ignore
        raise ValidationError(f"{field} must not be empty")
