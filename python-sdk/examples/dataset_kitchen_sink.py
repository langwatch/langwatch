"""
Dataset SDK Kitchen Sink Example

Demonstrates all dataset-related functionality available in the LangWatch Python SDK.
"""

import os
from dotenv import load_dotenv

load_dotenv()

try:
    import pandas as pd
except ImportError:
    print("Warning: pandas not available. Some features will be skipped.")
    pd = None

import langwatch
import traceback
from langwatch.dataset import get_dataset, Dataset, DatasetEntry, GetDatasetOptions


def main(messages=None):
    """Demonstrate all dataset SDK capabilities."""

    # Initialize LangWatch
    langwatch.setup()

    # Example dataset slug or ID (replace with your actual dataset)
    dataset_slug_or_id = os.getenv("LANGWATCH_DATASET_ID") or "test-dataset-1234"
    print(f"Dataset slug or ID: {dataset_slug_or_id}")
    print(
        f"LangWatch endpoint: {os.getenv('LANGWATCH_ENDPOINT') or langwatch._endpoint}"
    )

    if not dataset_slug_or_id:
        print("=" * 60)
        print("Dataset SDK Kitchen Sink Example")
        print("=" * 60)
        print(
            "\n⚠️  No dataset ID provided. Set LANGWATCH_DATASET_ID environment variable."
        )
        print("   Example: export LANGWATCH_DATASET_ID='your-dataset-slug-or-id'")
        print("\n   Continuing with mock examples...")
        print("=" * 60)

        # Demonstrate API without actual dataset
        demonstrate_api_structure()
        return

    print("=" * 60)
    print("Dataset SDK Kitchen Sink Example")
    print("=" * 60)

    try:
        # 1. Basic dataset retrieval
        print("\n1. Basic dataset retrieval:")
        print("-" * 60)
        dataset = get_dataset(dataset_slug_or_id)
        print(f"Retrieved dataset with {len(dataset.entries)} entries")
    except Exception as e:

        traceback.print_exc()
        print(f"Error retrieving dataset {dataset_slug_or_id}: {e}")
        print("\n   Continuing with API structure demonstration...")
        demonstrate_api_structure()
        return

    # 2. Access dataset entries
    print("\n2. Access dataset entries:")
    print("-" * 60)
    if dataset.entries:
        first_entry = dataset.entries[0]
        print(f"First entry ID: {first_entry.id}")
        print(f"First entry data: {first_entry.entry}")
    else:
        print("No entries found in dataset")

    # 3. Iterate over entries
    print("\n3. Iterate over entries:")
    print("-" * 60)
    print("First 3 entries:")
    for i, entry in enumerate(dataset.entries[:3]):
        print(f"  Entry {i+1}:")
        print(f"    ID: {entry.id}")
        print(f"    Data keys: {list(entry.entry.keys())}")

    # 4. Convert to pandas DataFrame
    print("\n4. Convert to pandas DataFrame:")
    print("-" * 60)
    if pd is not None:
        df = dataset.to_pandas()
        print(f"DataFrame shape: {df.shape}")
        print(f"DataFrame columns: {list(df.columns)}")
        print("\nFirst few rows:")
        print(df.head())
    else:
        print("pandas not available, skipping DataFrame conversion")

    # 5. Using GetDatasetOptions with ignore_tracing
    print("\n5. Retrieve dataset with ignore_tracing option:")
    print("-" * 60)
    options = GetDatasetOptions(ignore_tracing=True)
    dataset_no_trace = get_dataset(dataset_slug_or_id, options=options)
    print(f"Retrieved dataset (no tracing): {len(dataset_no_trace.entries)} entries")

    # 6. Access entry properties
    print("\n6. Access entry properties:")
    print("-" * 60)
    if dataset.entries:
        entry = dataset.entries[0]
        print(f"Entry ID: {entry.id}")
        print(f"Entry data type: {type(entry.entry)}")
        print(f"Entry data: {entry.entry}")

    # 7. Filter entries programmatically
    print("\n7. Filter entries programmatically:")
    print("-" * 60)
    if dataset.entries:
        # Example: find entries with a specific key
        entries_with_input = [e for e in dataset.entries if "input" in e.entry]
        print(f"Entries with 'input' key: {len(entries_with_input)}")

        # Example: get first entry's input if available
        if entries_with_input:
            first_input = entries_with_input[0].entry.get("input", "N/A")
            print(f"First entry input: {first_input[:50]}...")

    # 8. Convert specific entries to DataFrame
    print("\n8. Convert specific entries to DataFrame:")
    print("-" * 60)
    if dataset.entries and pd is not None:
        selected_entries = dataset.entries[:3]
        selected_df = pd.DataFrame([entry.entry for entry in selected_entries])
        print(f"Selected DataFrame shape: {selected_df.shape}")
        print(selected_df)
    elif pd is None:
        print("pandas not available, skipping DataFrame conversion")

    # 9. Handle empty dataset
    print("\n9. Handle empty dataset:")
    print("-" * 60)
    empty_dataset = Dataset(
        type("GetApiDatasetBySlugOrIdResponse200", (), {"data": []})()
    )
    print(f"Empty dataset entries: {len(empty_dataset.entries)}")
    if pd is not None:
        empty_df = empty_dataset.to_pandas()
        print(f"Empty DataFrame shape: {empty_df.shape}")
    else:
        print("pandas not available, skipping DataFrame conversion")

    print("\n" + "=" * 60)
    print("Dataset SDK examples completed!")
    print("=" * 60)


def demonstrate_api_structure():
    """Demonstrate API structure without actual dataset."""
    print("\nDataset SDK API Structure:")
    print("-" * 60)
    print("Available functions:")
    print("  - langwatch.dataset.get_dataset(slug_or_id, options=None)")
    print("  - langwatch.dataset.GetDatasetOptions(ignore_tracing=False)")
    print("\nDataset class methods:")
    print("  - dataset.entries: List[DatasetEntry]")
    print("  - dataset.to_pandas() -> pd.DataFrame")
    print("\nDatasetEntry properties:")
    print("  - entry.id: str")
    print("  - entry.entry: Dict[str, Any]")
    print("\nExample usage:")
    print("  dataset = langwatch.dataset.get_dataset('my-dataset-slug')")
    print("  df = dataset.to_pandas()")
    print("  for entry in dataset.entries:")
    print("      print(entry.id, entry.entry)")


if __name__ == "__main__":
    main()
