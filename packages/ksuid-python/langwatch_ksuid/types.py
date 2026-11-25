"""Type definitions for the KSUID library."""

from typing import Any, Protocol, TypedDict


class KsuidComponents(TypedDict):
    """Components of a KSUID."""

    # The environment (e.g., 'prod', 'dev', 'staging')
    environment: str
    # The resource type (e.g., 'user', 'order', 'product')
    resource: str
    # Unix timestamp in seconds when the KSUID was created
    timestamp: int
    # The instance identifier
    instance: Any  # Instance
    # Sequence number for collision avoidance
    sequence_id: int


class ParsedKsuid(TypedDict):
    """Parsed KSUID components from string parsing."""

    # The environment (defaults to 'prod' if not specified)
    environment: str
    # The resource type
    resource: str
    # The base62 encoded payload
    encoded: str


class InstanceScheme(TypedDict):
    """Instance scheme identifiers for different types of instance detection."""

    # Random identifier (82 = 'R' in ASCII)
    RANDOM: int
    # MAC address + PID identifier (72 = 'H' in ASCII)
    MAC_AND_PID: int
    # Docker container identifier (68 = 'D' in ASCII)
    DOCKER_CONT: int


# Type representing the possible instance scheme values
InstanceSchemeType = int


class PlatformInfo(TypedDict):
    """Platform detection information."""

    # True if running in a browser environment
    is_browser: bool
    # True if running in Node.js
    is_node: bool
    # True if running in Bun runtime
    is_bun: bool
    # True if running in Deno runtime
    is_deno: bool


class CryptoProvider(Protocol):
    """Crypto provider interface for random number generation."""

    def get_random_values(self, array: bytearray) -> bytearray:
        """Fills the provided array with cryptographically secure random values."""
        ...

    def random_bytes(self, size: int) -> bytes:
        """Optional method for generating random bytes (platform specific)."""
        ...


# Factory function to create Ksuid instances
KsuidFactory = type(lambda: None)  # Placeholder for the factory function type
