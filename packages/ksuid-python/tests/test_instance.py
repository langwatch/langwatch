"""Tests for instance identification."""

import pytest

from ksuid.instance import Instance, InstanceScheme


class TestInstanceScheme:
    """Test InstanceScheme constants."""

    def test_scheme_values(self):
        """Test that scheme values are correct."""
        assert InstanceScheme.RANDOM == 82  # 'R' in ASCII
        assert InstanceScheme.MAC_AND_PID == 72  # 'H' in ASCII
        assert InstanceScheme.DOCKER_CONT == 68  # 'D' in ASCII


class TestInstance:
    """Test Instance class."""

    def test_create_instance(self):
        """Test creating an instance with valid parameters."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        instance = Instance(InstanceScheme.RANDOM, identifier)

        assert instance.scheme == InstanceScheme.RANDOM
        assert instance.identifier == identifier

    def test_create_instance_with_different_schemes(self):
        """Test creating instances with different schemes."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])

        random_instance = Instance(InstanceScheme.RANDOM, identifier)
        assert random_instance.scheme == InstanceScheme.RANDOM

        mac_pid_instance = Instance(InstanceScheme.MAC_AND_PID, identifier)
        assert mac_pid_instance.scheme == InstanceScheme.MAC_AND_PID

        docker_instance = Instance(InstanceScheme.DOCKER_CONT, identifier)
        assert docker_instance.scheme == InstanceScheme.DOCKER_CONT

    def test_invalid_scheme(self):
        """Test that invalid scheme raises error."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])

        # Test negative scheme
        with pytest.raises(ValueError, match="scheme must be positive"):
            Instance(-1, identifier)

        # Test scheme too large
        with pytest.raises(ValueError, match="scheme must be a uint8"):
            Instance(256, identifier)

    def test_invalid_identifier_length(self):
        """Test that invalid identifier length raises error."""
        # Test too short
        with pytest.raises(ValueError, match="identifier must be 8 bytes"):
            Instance(InstanceScheme.RANDOM, bytes([1, 2, 3, 4, 5, 6, 7]))

        # Test too long
        with pytest.raises(ValueError, match="identifier must be 8 bytes"):
            Instance(InstanceScheme.RANDOM, bytes([1, 2, 3, 4, 5, 6, 7, 8, 9]))

        # Test wrong type
        with pytest.raises(ValueError, match="identifier must be a bytes object"):
            Instance(InstanceScheme.RANDOM, "not bytes")  # type: ignore

    def test_to_buffer(self):
        """Test converting instance to buffer."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        instance = Instance(InstanceScheme.RANDOM, identifier)

        buffer = instance.to_buffer()
        assert len(buffer) == 9
        assert buffer[0] == InstanceScheme.RANDOM
        assert buffer[1:] == identifier

    def test_to_buffer_caching(self):
        """Test that to_buffer caches the result."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        instance = Instance(InstanceScheme.RANDOM, identifier)

        buffer1 = instance.to_buffer()
        buffer2 = instance.to_buffer()

        assert buffer1 is buffer2  # Should be the same object due to caching

    def test_from_buffer(self):
        """Test creating instance from buffer."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        buffer = bytes([InstanceScheme.RANDOM]) + identifier

        instance = Instance.from_buffer(buffer)
        assert instance.scheme == InstanceScheme.RANDOM
        assert instance.identifier == identifier

    def test_from_buffer_invalid_length(self):
        """Test that invalid buffer length raises error."""
        # Test too short
        with pytest.raises(ValueError, match="buffer must be 9 bytes"):
            Instance.from_buffer(bytes([1, 2, 3, 4, 5, 6, 7, 8]))

        # Test too long
        with pytest.raises(ValueError, match="buffer must be 9 bytes"):
            Instance.from_buffer(bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))

    def test_string_representation(self):
        """Test string representation of instance."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        instance = Instance(InstanceScheme.RANDOM, identifier)

        string_repr = str(instance)
        assert "Instance" in string_repr
        assert "scheme=82" in string_repr
        assert "identifier=" in string_repr

    def test_equals(self):
        """Test instance equality."""
        identifier1 = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        identifier2 = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        identifier3 = bytes([9, 8, 7, 6, 5, 4, 3, 2])

        instance1 = Instance(InstanceScheme.RANDOM, identifier1)
        instance2 = Instance(InstanceScheme.RANDOM, identifier2)
        instance3 = Instance(InstanceScheme.RANDOM, identifier3)
        instance4 = Instance(InstanceScheme.MAC_AND_PID, identifier1)

        # Same scheme and identifier
        assert instance1.equals(instance2)
        assert instance1 == instance2

        # Different identifier
        assert not instance1.equals(instance3)
        assert instance1 != instance3

        # Different scheme
        assert not instance1.equals(instance4)
        assert instance1 != instance4

    def test_equals_with_different_types(self):
        """Test equality with non-Instance objects."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        instance = Instance(InstanceScheme.RANDOM, identifier)

        # Test with string (should use __eq__ method)
        assert instance != "not an instance"

    def test_hash(self):
        """Test instance hashing."""
        identifier1 = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        identifier2 = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        identifier3 = bytes([9, 8, 7, 6, 5, 4, 3, 2])

        instance1 = Instance(InstanceScheme.RANDOM, identifier1)
        instance2 = Instance(InstanceScheme.RANDOM, identifier2)
        instance3 = Instance(InstanceScheme.RANDOM, identifier3)

        # Same instances should have same hash
        assert hash(instance1) == hash(instance2)

        # Different instances should have different hashes
        assert hash(instance1) != hash(instance3)

    def test_immutability(self):
        """Test that instance properties are immutable."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        instance = Instance(InstanceScheme.RANDOM, identifier)

        # Properties should be read-only
        with pytest.raises(AttributeError):
            instance.scheme = InstanceScheme.MAC_AND_PID

        with pytest.raises(AttributeError):
            instance.identifier = bytes([9, 8, 7, 6, 5, 4, 3, 2])

    def test_identifier_copy(self):
        """Test that identifier property returns a copy."""
        identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        instance = Instance(InstanceScheme.RANDOM, identifier)

        returned_identifier = instance.identifier
        assert returned_identifier == identifier
        assert returned_identifier is not identifier  # Should be a copy
