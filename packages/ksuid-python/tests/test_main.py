"""Tests for main API functions."""

import time
from datetime import datetime

import pytest

from ksuid import (
    Instance,
    InstanceScheme,
    Ksuid,
    generate,
    get_environment,
    get_instance,
    parse,
    set_environment,
    set_instance,
)


class TestMainAPI:
    """Test main API functions."""

    def test_generate_basic(self):
        """Test basic KSUID generation."""
        ksuid = generate("user")

        assert isinstance(ksuid, Ksuid)
        assert ksuid.resource == "user"
        assert ksuid.environment == "prod"
        assert isinstance(ksuid.timestamp, int)
        assert isinstance(ksuid.instance, Instance)
        assert isinstance(ksuid.sequence_id, int)
        assert isinstance(ksuid.date, datetime)

        # String representation should be valid
        string_repr = str(ksuid)
        assert string_repr.startswith("user_")
        assert len(string_repr) > len("user_")

    def test_generate_different_resources(self):
        """Test generating KSUIDs for different resources."""
        user_ksuid = generate("user")
        order_ksuid = generate("order")
        product_ksuid = generate("product")

        assert user_ksuid.resource == "user"
        assert order_ksuid.resource == "order"
        assert product_ksuid.resource == "product"

        # All should have same environment
        assert user_ksuid.environment == "prod"
        assert order_ksuid.environment == "prod"
        assert product_ksuid.environment == "prod"

    def test_generate_unique_ids(self):
        """Test that generated IDs are unique."""
        ksuids = [generate("user") for _ in range(100)]
        ksuid_strings = [str(ksuid) for ksuid in ksuids]

        # All should be unique
        assert len(set(ksuid_strings)) == 100

        # All should be different Ksuid objects
        assert len(set(ksuids)) == 100

    def test_parse_valid_ksuid(self):
        """Test parsing valid KSUID strings."""
        original = generate("user")
        string_repr = str(original)

        parsed = parse(string_repr)

        assert isinstance(parsed, Ksuid)
        assert parsed.resource == original.resource
        assert parsed.environment == original.environment
        assert parsed.timestamp == original.timestamp
        assert parsed.sequence_id == original.sequence_id
        assert parsed.equals(original)

    def test_parse_invalid_strings(self):
        """Test parsing invalid strings."""
        # Empty string
        with pytest.raises(ValueError, match="Input must not be empty"):
            parse("")

        # Invalid format
        with pytest.raises(ValueError, match="ID is invalid"):
            parse("invalid")

        # Missing encoded part
        with pytest.raises(ValueError, match="ID is invalid"):
            parse("user_")

        # Too short encoded part
        with pytest.raises(ValueError, match="ID is invalid"):
            parse("user_123")

    def test_environment_management(self):
        """Test environment getter and setter."""
        # Default environment should be 'prod'
        assert get_environment() == "prod"

        # Set to dev
        set_environment("dev")
        assert get_environment() == "dev"

        # Generate KSUID with dev environment
        ksuid = generate("user")
        assert ksuid.environment == "dev"
        assert str(ksuid).startswith("dev_user_")

        # Set back to prod
        set_environment("prod")
        assert get_environment() == "prod"

        # Generate KSUID with prod environment (no prefix)
        ksuid = generate("user")
        assert ksuid.environment == "prod"
        assert str(ksuid).startswith("user_")

    def test_invalid_environment(self):
        """Test setting invalid environment."""
        with pytest.raises(ValueError, match="environment contains invalid characters"):
            set_environment("invalid-env")

        with pytest.raises(ValueError, match="environment contains invalid characters"):
            set_environment("INVALID")

        with pytest.raises(ValueError, match="environment contains invalid characters"):
            set_environment("invalid env")

    def test_instance_management(self):
        """Test instance getter and setter."""
        # Get current instance
        current_instance = get_instance()
        assert isinstance(current_instance, Instance)

        # Create custom instance
        custom_identifier = bytes([1, 2, 3, 4, 5, 6, 7, 8])
        custom_instance = Instance(InstanceScheme.RANDOM, custom_identifier)

        # Set custom instance
        set_instance(custom_instance)

        # Verify it's set
        assert get_instance() == custom_instance

        # Generate KSUID with custom instance
        ksuid = generate("user")
        assert ksuid.instance == custom_instance

    def test_ksuid_properties(self):
        """Test KSUID properties."""
        ksuid = generate("user")

        # Test timestamp
        assert isinstance(ksuid.timestamp, int)
        assert ksuid.timestamp > 0

        # Test date
        assert isinstance(ksuid.date, datetime)
        assert ksuid.date.timestamp() == ksuid.timestamp

        # Test instance
        assert isinstance(ksuid.instance, Instance)
        assert isinstance(ksuid.instance.scheme, int)
        assert isinstance(ksuid.instance.identifier, bytes)
        assert len(ksuid.instance.identifier) == 8

    def test_ksuid_equality(self):
        """Test KSUID equality."""
        ksuid1 = generate("user")
        ksuid2 = generate("user")

        # Different KSUIDs should not be equal
        assert ksuid1 != ksuid2
        assert not ksuid1.equals(ksuid2)

        # Same KSUID should be equal to itself
        assert ksuid1 == ksuid1
        assert ksuid1.equals(ksuid1)

        # Parsed KSUID should be equal to original
        parsed = parse(str(ksuid1))
        assert ksuid1 == parsed
        assert ksuid1.equals(parsed)

    def test_ksuid_json(self):
        """Test KSUID JSON representation."""
        ksuid = generate("user")
        json_repr = ksuid.to_json()

        assert isinstance(json_repr, dict)
        assert json_repr["environment"] == ksuid.environment
        assert json_repr["resource"] == ksuid.resource
        assert json_repr["timestamp"] == ksuid.timestamp
        assert json_repr["sequence_id"] == ksuid.sequence_id
        assert json_repr["string"] == str(ksuid)

        # Test date format
        assert "date" in json_repr
        assert isinstance(json_repr["date"], str)

        # Test instance format
        assert "instance" in json_repr
        assert isinstance(json_repr["instance"], dict)
        assert "scheme" in json_repr["instance"]
        assert "identifier" in json_repr["instance"]
        assert isinstance(json_repr["instance"]["identifier"], list)

    def test_ksuid_sorting(self):
        """Test that KSUIDs are naturally sortable by timestamp."""
        # Generate KSUIDs with small time delays
        ksuids: list[Ksuid] = []
        for _ in range(5):
            time.sleep(0.001)  # Small delay to ensure different timestamps
            ksuids.append(generate("user"))

        # Sort by string representation
        sorted_strings = sorted(str(ksuid) for ksuid in ksuids)

        # Sort by timestamp
        sorted_timestamps = sorted(ksuids, key=lambda k: k.timestamp)
        sorted_timestamp_strings = [str(ksuid) for ksuid in sorted_timestamps]

        # Both should be the same (K-sortable)
        assert sorted_strings == sorted_timestamp_strings

    def test_ksuid_hash(self):
        """Test KSUID hashing."""
        ksuid1 = generate("user")
        ksuid2 = generate("user")

        # Different KSUIDs should have different hashes
        assert hash(ksuid1) != hash(ksuid2)

        # Same KSUID should have same hash
        assert hash(ksuid1) == hash(ksuid1)

        # Parsed KSUID should have same hash as original
        parsed = parse(str(ksuid1))
        assert hash(ksuid1) == hash(parsed)
