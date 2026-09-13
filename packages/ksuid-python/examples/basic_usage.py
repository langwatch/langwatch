#!/usr/bin/env python3
"""
Basic usage example for langwatch-ksuid.

This example demonstrates the core functionality of the KSUID library.
"""

from ksuid import Ksuid, generate, parse, set_environment


def main():
    """Demonstrate basic KSUID usage."""
    print("=== LangWatch KSUID Basic Usage Example ===\n")

    # Basic KSUID generation
    print("1. Basic KSUID Generation:")
    user_id = generate("user")
    order_id = generate("order")
    product_id = generate("product")

    print(f"   User ID: {user_id}")
    print(f"   Order ID: {order_id}")
    print(f"   Product ID: {product_id}")
    print()

    # Environment-specific KSUIDs
    print("2. Environment-Specific KSUIDs:")
    set_environment("dev")
    dev_user_id = generate("user")
    print(f"   Dev User ID: {dev_user_id}")

    set_environment("staging")
    staging_user_id = generate("user")
    print(f"   Staging User ID: {staging_user_id}")

    set_environment("prod")
    prod_user_id = generate("user")
    print(f"   Prod User ID: {prod_user_id}")
    print()

    # Parsing KSUIDs
    print("3. Parsing KSUIDs:")
    ksuid_string = str(user_id)
    parsed_ksuid = parse(ksuid_string)

    print(f"   Original: {user_id}")
    print(f"   Parsed:   {parsed_ksuid}")
    print(f"   Equal:    {user_id == parsed_ksuid}")
    print()

    # KSUID properties
    print("4. KSUID Properties:")
    print(f"   Resource:     {user_id.resource}")
    print(f"   Environment:  {user_id.environment}")
    print(f"   Timestamp:    {user_id.timestamp}")
    print(f"   Date:         {user_id.date}")
    print(f"   Sequence ID:  {user_id.sequence_id}")
    print(f"   Instance:     {user_id.instance}")
    print()

    # JSON representation
    print("5. JSON Representation:")
    json_data = user_id.to_json()
    for key, value in json_data.items():
        print(f"   {key}: {value}")
    print()

    # K-sortable demonstration
    print("6. K-Sortable Demonstration:")
    import time

    ksuids: list[Ksuid] = []
    for _ in range(3):
        time.sleep(0.001)  # Small delay
        ksuids.append(generate("item"))

    print("   Generated KSUIDs (in order):")
    for i, ksuid in enumerate(ksuids, 1):
        print(f"   {i}. {ksuid}")

    print("\n   Sorted by string (should be same order):")
    sorted_ksuids = sorted(str(ksuid) for ksuid in ksuids)
    for i, ksuid_str in enumerate(sorted_ksuids, 1):
        print(f"   {i}. {ksuid_str}")

    print("\n=== Example Complete ===")


if __name__ == "__main__":
    main()
