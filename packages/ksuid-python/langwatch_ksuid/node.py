"""KSUID generation factory."""

import os
import platform
import socket
import subprocess
import threading
import time
from typing import Callable, Optional

from .instance import Instance, InstanceScheme
from .ksuid import Ksuid
from .platform import get_random_bytes
from .validation import check_instance, check_non_empty_string, check_prefix

# Type alias for the factory function
KsuidFactory = Callable[[str, str, int, Instance, int], "Ksuid"]


class Node:
    """KSUID generation factory with automatic instance detection."""

    def __init__(
        self,
        environment: str = "prod",
        instance: Optional[Instance] = None,
        ksuid_factory: Optional[KsuidFactory] = None,
    ) -> None:
        """
        Initialize the Node with environment and instance configuration.

        Args:
            environment: The environment name (default: 'prod')
            instance: Optional custom instance (auto-detected if None)
            ksuid_factory: Optional factory function for creating KSUIDs
        """
        self._environment = environment
        self._instance = instance or self._create_instance()
        self._ksuid_factory = ksuid_factory or self._default_ksuid_factory
        self._last_timestamp = 0
        self._current_sequence = 0
        self._lock = threading.Lock()

    @property
    def environment(self) -> str:
        """The current environment."""
        return self._environment

    @environment.setter
    def environment(self, value: str) -> None:
        """Set the environment."""
        check_prefix("environment", value)
        self._environment = value

    @property
    def instance(self) -> Instance:
        """The current instance."""
        return self._instance

    @instance.setter
    def instance(self, value: Instance) -> None:
        """Set the instance."""
        check_instance("instance", value)
        self._instance = value

    def generate(self, resource: str) -> "Ksuid":
        """
        Generate a new KSUID for the specified resource.

        Args:
            resource: The resource type (e.g., 'user', 'order', 'product')

        Returns:
            A new Ksuid instance

        Raises:
            ValidationError: If the resource is invalid
        """
        check_non_empty_string("resource", resource)

        with self._lock:
            now = int(time.time())

            if self._last_timestamp == now:
                self._current_sequence += 1
            else:
                self._last_timestamp = now
                self._current_sequence = 0

        return self._ksuid_factory(
            self._environment,
            resource,
            self._last_timestamp,
            self._instance,
            self._current_sequence,
        )

    def _default_ksuid_factory(
        self,
        environment: str,
        resource: str,
        timestamp: int,
        instance: Instance,
        sequence_id: int,
    ) -> "Ksuid":
        """Default factory function that raises an error."""
        raise RuntimeError("Ksuid factory not initialized")

    def _create_instance(self) -> Instance:
        """Create an instance using platform-specific detection."""
        # Try Docker container first
        docker_instance = self._get_docker_instance()
        if docker_instance:
            return docker_instance

        # Try MAC + PID
        mac_pid_instance = self._get_mac_pid_instance()
        if mac_pid_instance:
            return mac_pid_instance

        # Fallback to random
        buf = get_random_bytes(8)
        return Instance(InstanceScheme.RANDOM, buf)

    def _get_docker_instance(self) -> Optional[Instance]:
        """Try to get Docker container instance."""
        try:
            # Check if we're in a Docker container
            if not os.path.exists("/proc/1/cpuset"):
                return None

            with open("/proc/1/cpuset") as f:
                src = f.read().strip()

            if not src.startswith("/docker"):
                return None

            container_id = os.path.basename(src)
            if len(container_id) != 64:
                return None

            # Convert hex container ID to bytes
            try:
                container_bytes = bytes.fromhex(container_id)
                if len(container_bytes) != 32:
                    return None

                return Instance(InstanceScheme.DOCKER_CONT, container_bytes[:8])
            except ValueError:
                return None

        except OSError:
            return None

    def _get_mac_pid_instance(self) -> Optional[Instance]:
        """Try to get MAC address + PID instance."""
        try:
            # Get MAC address
            mac_address = self._get_mac_address()
            if not mac_address:
                return None

            # Convert MAC address to bytes
            mac_bytes = bytes.fromhex(mac_address.replace(":", ""))

            # Create 8-byte buffer
            buf = bytearray(8)
            buf[:6] = mac_bytes[:6]

            # Write PID in last 2 bytes
            pid = os.getpid() % 65536
            buf[6] = (pid >> 8) & 0xFF
            buf[7] = pid & 0xFF

            return Instance(InstanceScheme.MAC_AND_PID, bytes(buf))

        except (OSError, ValueError):
            return None

    def _get_mac_address(self) -> Optional[str]:
        """Get the first non-loopback MAC address."""
        try:
            # Try to get MAC address using platform-specific methods
            if platform.system() == "Windows":
                return self._get_mac_address_windows()
            else:
                return self._get_mac_address_unix()

        except (OSError, socket.gaierror):
            return None

    def _get_mac_address_windows(self) -> Optional[str]:
        """Get MAC address on Windows."""
        try:
            result = subprocess.run(
                ["ipconfig", "/all"], capture_output=True, text=True, check=True
            )

            # Parse ipconfig output to find Physical Address
            lines = result.stdout.split("\n")
            for line in lines:
                if "Physical Address" in line:
                    mac = line.split(":")[-1].strip()
                    if mac and mac != "00-00-00-00-00-00":
                        return mac.replace("-", ":")

            return None

        except (subprocess.SubprocessError, FileNotFoundError):
            return None

    def _get_mac_address_unix(self) -> Optional[str]:
        """Get MAC address on Unix-like systems."""
        try:
            # Try to read from /sys/class/net
            for interface in os.listdir("/sys/class/net"):
                if interface == "lo":  # Skip loopback
                    continue

                addr_file = f"/sys/class/net/{interface}/address"
                if os.path.exists(addr_file):
                    with open(addr_file) as f:
                        mac = f.read().strip()
                        if mac and mac != "00:00:00:00:00:00":
                            return mac

            return None

        except OSError:
            return None
