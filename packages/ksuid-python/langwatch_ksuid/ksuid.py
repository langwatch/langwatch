"""Main KSUID class implementation."""

from datetime import datetime
from typing import Any, Dict, Optional

from .base62 import decode, encode
from .constants import DECODED_LEN, ENCODED_LEN, KSUID_REGEX
from .errors import ValidationError
from .instance import Instance
from .validation import check_instance, check_prefix, check_uint


class Ksuid:
    """
    Represents a K-Sortable Unique IDentifier (KSUID).

    KSUIDs are globally unique, k-sortable identifiers that include:
    - Environment prefix (optional, defaults to 'prod')
    - Resource type (e.g., 'user', 'order')
    - Timestamp (48-bit Unix timestamp)
    - Instance identifier (8 bytes)
    - Sequence number (32-bit counter)

    Example:
        >>> ksuid = Ksuid('prod', 'user', 1234567890, instance, 0)
        >>> print(ksuid)  # 'user_0001q4bXFY4siSyoTTkaIIabGiMZo'
    """

    def __init__(
        self,
        environment: str,
        resource: str,
        timestamp: int,
        instance: Instance,
        sequence_id: int,
    ) -> None:
        """
        Creates a new KSUID instance.

        Args:
            environment: The environment (e.g., 'prod', 'dev', 'staging')
            resource: The resource type (e.g., 'user', 'order', 'product')
            timestamp: Unix timestamp in seconds (48-bit)
            instance: The instance identifier
            sequence_id: Sequence number for collision avoidance

        Raises:
            ValidationError: If any parameter is invalid
        """
        check_prefix("environment", environment)
        check_prefix("resource", resource)
        check_uint("timestamp", timestamp, 6)
        check_instance("instance", instance)
        check_uint("sequence_id", sequence_id, 4)

        self._environment = environment
        self._resource = resource
        self._timestamp = timestamp
        self._instance = instance
        self._sequence_id = sequence_id
        self._string: Optional[str] = None

    @property
    def environment(self) -> str:
        """The environment (e.g., 'prod', 'dev', 'staging')."""
        return self._environment

    @property
    def resource(self) -> str:
        """The resource type (e.g., 'user', 'order', 'product')."""
        return self._resource

    @property
    def timestamp(self) -> int:
        """Unix timestamp in seconds when the KSUID was created."""
        return self._timestamp

    @property
    def instance(self) -> Instance:
        """The instance identifier."""
        return self._instance

    @property
    def sequence_id(self) -> int:
        """Sequence number for collision avoidance."""
        return self._sequence_id

    @property
    def date(self) -> datetime:
        """Python datetime object representing the creation time."""
        return datetime.fromtimestamp(self._timestamp)

    def __str__(self) -> str:
        """
        Converts the KSUID to its string representation.

        Returns:
            The KSUID as a string (e.g., 'user_0001q4bXFY4siSyoTTkaIIabGiMZo')

        Example:
            >>> ksuid = generate('user')
            >>> print(ksuid)  # 'user_0001q4bXFY4siSyoTTkaIIabGiMZo'
        """
        # Cache the string since it's immutable
        if self._string is not None:
            return self._string

        env = "" if self._environment == "prod" else f"{self._environment}_"
        prefix = f"{env}{self._resource}_"

        decoded = bytearray(DECODED_LEN)

        # Write timestamp (48 bits, 6 bytes)
        # Note: Python can handle 64-bit numbers, but we use 48 bits for compatibility
        decoded[0] = 0  # High byte always 0
        decoded[1] = 0  # High byte always 0
        decoded[2] = (self._timestamp >> 40) & 0xFF
        decoded[3] = (self._timestamp >> 32) & 0xFF
        decoded[4] = (self._timestamp >> 24) & 0xFF
        decoded[5] = (self._timestamp >> 16) & 0xFF
        decoded[6] = (self._timestamp >> 8) & 0xFF
        decoded[7] = self._timestamp & 0xFF

        # Write instance (9 bytes)
        instance_buffer = self._instance.to_buffer()
        decoded[8:17] = instance_buffer

        # Write sequence ID (4 bytes)
        decoded[17] = (self._sequence_id >> 24) & 0xFF
        decoded[18] = (self._sequence_id >> 16) & 0xFF
        decoded[19] = (self._sequence_id >> 8) & 0xFF
        decoded[20] = self._sequence_id & 0xFF

        encoded = encode(bytes(decoded))
        padded = encoded.zfill(ENCODED_LEN)

        self._string = prefix + padded
        return self._string

    @classmethod
    def parse(cls, input_str: str) -> "Ksuid":
        """
        Parses a KSUID string and returns a Ksuid instance.

        Args:
            input_str: The KSUID string to parse

        Returns:
            A new Ksuid instance

        Raises:
            ValidationError: If the input is invalid or malformed

        Example:
            >>> ksuid = Ksuid.parse('user_0001q4bXFY4siSyoTTkaIIabGiMZo')
            >>> print(ksuid.resource)  # 'user'
        """
        if not input_str:
            raise ValidationError("Input must not be empty")

        parsed = cls._split_prefix_id(input_str)

        decoded = decode(parsed["encoded"], DECODED_LEN)
        full_decoded = bytearray(decoded)

        # Check if timestamp is too large
        if full_decoded[0] != 0 or full_decoded[1] != 0:
            raise ValidationError("Timestamp greater than 8921556-12-07T10:44:16Z")

        timestamp = (
            (full_decoded[2] << 40)
            | (full_decoded[3] << 32)
            | (full_decoded[4] << 24)
            | (full_decoded[5] << 16)
            | (full_decoded[6] << 8)
            | full_decoded[7]
        )

        instance = Instance.from_buffer(bytes(full_decoded[8:17]))

        sequence_id = (
            (full_decoded[17] << 24)
            | (full_decoded[18] << 16)
            | (full_decoded[19] << 8)
            | full_decoded[20]
        )

        return cls(
            parsed["environment"], parsed["resource"], timestamp, instance, sequence_id
        )

    def equals(self, other: "Ksuid") -> bool:
        """
        Compares this KSUID with another for equality.

        Args:
            other: The KSUID to compare with

        Returns:
            True if both KSUIDs are equal, false otherwise

        Example:
            >>> ksuid1 = generate('user')
            >>> ksuid2 = generate('user')
            >>> print(ksuid1.equals(ksuid2))  # false (different timestamps)
        """
        return (
            self._environment == other._environment
            and self._resource == other._resource
            and self._timestamp == other._timestamp
            and self._instance.equals(other._instance)
            and self._sequence_id == other._sequence_id
        )

    def __eq__(self, other: object) -> bool:
        """Equality comparison."""
        return self.equals(other) if isinstance(other, Ksuid) else False

    def __hash__(self) -> int:
        """Hash based on all components."""
        return hash(
            (
                self._environment,
                self._resource,
                self._timestamp,
                self._instance,
                self._sequence_id,
            )
        )

    def to_json(self) -> Dict[str, Any]:
        """
        Converts the KSUID to a JSON object representation.

        Returns:
            An object containing all KSUID components

        Example:
            >>> ksuid = generate('user')
            >>> print(ksuid.to_json())
            # {
            #   'environment': 'prod',
            #   'resource': 'user',
            #   'timestamp': 1234567890,
            #   'date': '2009-02-13T23:31:30.000000',
            #   'instance': {'scheme': 82, 'identifier': [1,2,3,4,5,6,7,8]},
            #   'sequence_id': 0,
            #   'string': 'user_0001q4bXFY4siSyoTTkaIIabGiMZo'
            # }
        """
        return {
            "environment": self._environment,
            "resource": self._resource,
            "timestamp": self._timestamp,
            "date": self.date.isoformat(),
            "instance": {
                "scheme": self._instance.scheme,
                "identifier": list(self._instance.identifier),
            },
            "sequence_id": self._sequence_id,
            "string": str(self),
        }

    @staticmethod
    def _split_prefix_id(input_str: str) -> Dict[str, str]:
        """Split a KSUID string into its components."""
        match = KSUID_REGEX.match(input_str)

        if not match:
            raise ValidationError("ID is invalid")

        environment, resource, encoded = match.groups()

        if environment == "prod":
            raise ValidationError("Production environment is implied")

        return {
            "environment": environment or "prod",
            "resource": resource,
            "encoded": encoded,
        }
