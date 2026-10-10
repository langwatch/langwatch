"""
LangWatch KSUID - A modern, zero-dependency Python library for generating prefixed, k-sorted globally unique identifiers.
"""

from .constants import (
    DECODED_LEN,
    ENCODED_LEN,
    KSUID_REGEX,
    MAX_DATE,
    MAX_TIMESTAMP,
    PREFIX_REGEX,
)
from .errors import Base62Error, ValidationError
from .instance import Instance, InstanceScheme
from .ksuid import Ksuid
from .node import Node
from .platform import detect_platform, get_crypto_provider, get_random_bytes
from .types import (
    CryptoProvider,
    InstanceSchemeType,
    KsuidComponents,
    ParsedKsuid,
    PlatformInfo,
)

# Singleton node instance with proper KSUID factory
_node = Node(
    "prod",
    None,
    lambda environment, resource, timestamp, instance, sequence_id: Ksuid(
        environment, resource, timestamp, instance, sequence_id
    ),
)


def parse(input_str: str) -> Ksuid:
    """
    Parses a KSUID string and returns a Ksuid instance.

    Args:
        input_str: The KSUID string to parse

    Returns:
        A Ksuid instance

    Raises:
        ValidationError: If the input is invalid or malformed

    Example:
        >>> ksuid = parse('user_2XH7K9P8Q1R3S4T5U6V7W8X9Y0Z1A2B3C4D5E6F')
        >>> print(ksuid.resource)  # 'user'
    """
    return Ksuid.parse(input_str)


def generate(resource: str) -> Ksuid:
    """
    Generates a new KSUID for the specified resource.

    Args:
        resource: The resource type (e.g., 'user', 'order', 'product')

    Returns:
        A new Ksuid instance

    Example:
        >>> ksuid = generate('user')
        >>> print(ksuid)  # 'user_0001q4bXFY4siSyoTTkaIIabGiMZo'
    """
    return _node.generate(resource)


def get_environment() -> str:
    """
    Gets the current environment setting.

    Returns:
        The current environment (default: 'prod')

    Example:
        >>> env = get_environment()  # 'prod'
    """
    return _node.environment


def set_environment(value: str) -> None:
    """
    Sets the current environment for KSUID generation.

    Args:
        value: The environment name (e.g., 'dev', 'staging', 'prod')

    Example:
        >>> set_environment('dev')
        >>> ksuid = generate('user')  # 'dev_user_...'
    """
    _node.environment = value


def get_instance() -> Instance:
    """
    Gets the current instance configuration.

    Returns:
        The current Instance object

    Example:
        >>> instance = get_instance()
        >>> print(instance.scheme)  # Instance scheme
    """
    return _node.instance


def set_instance(value: Instance) -> None:
    """
    Sets the current instance for KSUID generation.

    Args:
        value: The Instance object to use

    Example:
        >>> instance = Instance(InstanceScheme.RANDOM, bytes(8))
        >>> set_instance(instance)
    """
    _node.instance = value


__all__ = [
    # Main functions
    "generate",
    "parse",
    "get_environment",
    "set_environment",
    "get_instance",
    "set_instance",
    # Classes
    "Ksuid",
    "Node",
    "Instance",
    # Types
    "InstanceScheme",
    "InstanceSchemeType",
    "KsuidComponents",
    "ParsedKsuid",
    "PlatformInfo",
    "CryptoProvider",
    # Constants
    "DECODED_LEN",
    "ENCODED_LEN",
    "KSUID_REGEX",
    "PREFIX_REGEX",
    "MAX_TIMESTAMP",
    "MAX_DATE",
    # Error classes
    "ValidationError",
    "Base62Error",
    # Platform functions
    "detect_platform",
    "get_crypto_provider",
    "get_random_bytes",
]

__version__ = "1.0.1"  # x-release-please-version
