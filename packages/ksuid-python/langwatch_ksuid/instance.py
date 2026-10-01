"""Machine/container instance identification."""

from typing import Final, Optional

from .validation import check_bytes, check_uint


class InstanceScheme:
    """Available instance schemes."""

    # Random identifier (82 = 'R' in ASCII)
    RANDOM: Final[int] = 82
    # MAC address + PID identifier (72 = 'H' in ASCII)
    MAC_AND_PID: Final[int] = 72
    # Docker container identifier (68 = 'D' in ASCII)
    DOCKER_CONT: Final[int] = 68


class Instance:
    """
    Represents a machine/container instance identifier.

    Instances are used to ensure uniqueness across different machines
    or containers when generating KSUIDs simultaneously.

    Example:
        >>> instance = Instance(InstanceScheme.RANDOM, bytes(8))
        >>> ksuid = Ksuid('prod', 'user', int(time.time()), instance, 0)
    """

    def __init__(self, scheme: int, identifier: bytes) -> None:
        """
        Creates a new Instance with the specified scheme and identifier.

        Args:
            scheme: The instance scheme (RANDOM, MAC_AND_PID, or DOCKER_CONT)
            identifier: 8-byte identifier for the instance

        Raises:
            ValidationError: If the scheme or identifier is invalid
        """
        check_uint("scheme", scheme, 1)
        check_bytes("identifier", identifier, 8)

        self._scheme = scheme
        self._identifier = identifier
        self._buffer: Optional[bytes] = None

    @property
    def scheme(self) -> int:
        """The instance scheme (RANDOM, MAC_AND_PID, or DOCKER_CONT)."""
        return self._scheme

    @property
    def identifier(self) -> bytes:
        """The 8-byte instance identifier."""
        return bytes(bytearray(self._identifier))  # Return a copy via bytearray

    def to_buffer(self) -> bytes:
        """
        Converts the instance to a 9-byte buffer (scheme + identifier).

        Returns:
            A bytes object containing the scheme byte followed by the identifier

        Example:
            >>> instance = Instance(InstanceScheme.RANDOM, bytes(8))
            >>> buffer = instance.to_buffer()  # 9 bytes: [82, 0, 0, 0, 0, 0, 0, 0, 0]
        """
        # Cache the buffer since it's immutable
        if self._buffer is not None:
            return self._buffer

        buf = bytearray(9)
        buf[0] = self._scheme
        buf[1:] = self._identifier

        self._buffer = bytes(buf)
        return self._buffer

    @classmethod
    def from_buffer(cls, buffer: bytes) -> "Instance":
        """
        Creates an Instance from a 9-byte buffer.

        Args:
            buffer: A 9-byte buffer containing scheme byte + identifier

        Returns:
            A new Instance object

        Raises:
            ValidationError: If the buffer is not exactly 9 bytes

        Example:
            >>> buffer = bytes([82, 1, 2, 3, 4, 5, 6, 7, 8])
            >>> instance = Instance.from_buffer(buffer)
        """
        check_bytes("buffer", buffer, 9)

        return cls(buffer[0], buffer[1:])

    def __str__(self) -> str:
        """
        Returns a string representation of the instance.

        Returns:
            A string showing the scheme and identifier

        Example:
            >>> instance = Instance(InstanceScheme.RANDOM, bytes([1,2,3,4,5,6,7,8]))
            >>> print(instance)  # 'Instance(scheme=82, identifier=b'\\x01\\x02\\x03\\x04\\x05\\x06\\x07\\x08')'
        """
        return f"Instance(scheme={self._scheme}, identifier={self._identifier!r})"

    def equals(self, other: "Instance") -> bool:
        """
        Compares this instance with another for equality.

        Args:
            other: The instance to compare with

        Returns:
            True if both instances have the same scheme and identifier

        Example:
            >>> instance1 = Instance(InstanceScheme.RANDOM, bytes(8))
            >>> instance2 = Instance(InstanceScheme.RANDOM, bytes(8))
            >>> print(instance1.equals(instance2))  # True
        """
        return self._scheme == other._scheme and self._identifier == other._identifier

    def __eq__(self, other: object) -> bool:
        """Equality comparison."""
        return self.equals(other) if isinstance(other, Instance) else False

    def __hash__(self) -> int:
        """Hash based on scheme and identifier."""
        return hash((self._scheme, self._identifier))
