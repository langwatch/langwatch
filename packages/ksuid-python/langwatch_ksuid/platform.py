"""Platform detection and crypto operations."""

import secrets

from .types import CryptoProvider, PlatformInfo


def detect_platform() -> PlatformInfo:
    """
    Detects the current platform/runtime environment.

    Returns:
        Platform information including flags for browser, Node.js, Bun, and Deno

    Example:
        >>> platform_info = detect_platform()
        >>> if platform_info['is_node']:
        ...     print('Running in Node.js')
    """
    # Python doesn't run in browsers, Node.js, Bun, or Deno
    return {
        "is_browser": False,
        "is_node": False,
        "is_bun": False,
        "is_deno": False,
    }


class PythonCryptoProvider:
    """Crypto provider for Python using secrets module."""

    def get_random_values(self, array: bytearray) -> bytearray:
        """
        Fills the provided array with cryptographically secure random values.

        Args:
            array: The array to fill with random bytes

        Returns:
            The filled array
        """
        array[:] = secrets.token_bytes(len(array))
        return array

    def random_bytes(self, size: int) -> bytes:
        """
        Generates cryptographically secure random bytes.

        Args:
            size: The number of random bytes to generate

        Returns:
            A bytes object filled with random bytes
        """
        return secrets.token_bytes(size)


def get_crypto_provider() -> CryptoProvider:
    """
    Gets the appropriate crypto provider for the current platform.

    Returns:
        A crypto provider with get_random_values method

    Example:
        >>> crypto = get_crypto_provider()
        >>> random_bytes = crypto.get_random_values(bytearray(16))
    """
    return PythonCryptoProvider()


def get_random_bytes(size: int) -> bytes:
    """
    Generates cryptographically secure random bytes.

    Args:
        size: The number of random bytes to generate

    Returns:
        A bytes object filled with random bytes

    Example:
        >>> random_bytes = get_random_bytes(16)
        >>> print(len(random_bytes))  # 16
    """
    crypto = get_crypto_provider()
    return crypto.random_bytes(size)
