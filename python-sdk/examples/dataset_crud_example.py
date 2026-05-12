"""
Dataset CRUD Example

Exercises all new dataset SDK methods against a real LangWatch instance.

Usage:
    export LANGWATCH_API_KEY="sk-lw-..."
    export LANGWATCH_ENDPOINT="http://localhost:5560"  # or https://app.langwatch.ai
    cd python-sdk && poetry run python examples/dataset_crud_example.py
"""

import os
import sys
import tempfile

from dotenv import load_dotenv

load_dotenv()

import langwatch

langwatch.setup()

ENDPOINT = os.getenv("LANGWATCH_ENDPOINT", "https://app.langwatch.ai")
print(f"Endpoint: {ENDPOINT}")
print(f"API Key: {os.getenv('LANGWATCH_API_KEY', '')[:10]}...")
print("=" * 60)


def main():
    dataset_slug = None
    try:
        # ── 1. List datasets ────────────────────────────────
        print("\n1. List datasets")
        result = langwatch.dataset.list_datasets()
        print(f"   Found {result.pagination.total} datasets (page {result.pagination.page})")
        for ds in result.data[:3]:
            print(f"   - {ds.name} ({ds.slug})")

        # ── 2. Create a dataset ─────────────────────────────
        print("\n2. Create dataset")
        info = langwatch.dataset.create_dataset(
            "SDK Test Dataset",
            columns=[
                {"name": "input", "type": "string"},
                {"name": "output", "type": "string"},
            ],
        )
        dataset_slug = info.slug
        print(f"   Created: {info.name} (slug={info.slug}, id={info.id})")

        # ── 3. Get dataset ──────────────────────────────────
        print("\n3. Get dataset")
        ds = langwatch.dataset.get_dataset(dataset_slug)
        print(f"   Got: {ds.name} with {len(ds.entries)} entries")

        # ── 4. Update dataset ───────────────────────────────
        print("\n4. Update dataset")
        updated = langwatch.dataset.update_dataset(
            dataset_slug,
            name="SDK Test Dataset (Updated)",
        )
        dataset_slug = updated.slug  # slug may change with name
        print(f"   Updated: {updated.name} (slug={updated.slug})")

        # ── 5. Create records ───────────────────────────────
        print("\n5. Create records")
        records = langwatch.dataset.create_records(
            dataset_slug,
            entries=[
                {"input": "What is 2+2?", "output": "4"},
                {"input": "Hello", "output": "Hi there!"},
                {"input": "Goodbye", "output": "See you later!"},
            ],
        )
        print(f"   Created {len(records)} records:")
        for rec in records:
            print(f"   - {rec.id}: {rec.entry}")

        # ── 6. List records ─────────────────────────────────
        print("\n6. List records")
        page = langwatch.dataset.list_records(dataset_slug, page=1, limit=10)
        print(f"   Page {page.pagination.page}: {len(page.data)} records (total: {page.pagination.total})")

        # ── 7. Update a record ──────────────────────────────
        print("\n7. Update a record")
        if records:
            rec_id = records[0].id
            updated_rec = langwatch.dataset.update_record(
                dataset_slug,
                rec_id,
                entry={"input": "What is 2+2?", "output": "The answer is 4."},
            )
            print(f"   Updated {updated_rec.id}: {updated_rec.entry}")

        # ── 8. Delete records ───────────────────────────────
        print("\n8. Delete records")
        if len(records) >= 2:
            deleted = langwatch.dataset.delete_records(
                dataset_slug,
                record_ids=[records[-1].id],
            )
            print(f"   Deleted {deleted} record(s)")

        # ── 9. Upload CSV ───────────────────────────────────
        print("\n9. Upload CSV file")
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            f.write("input,output\n")
            f.write("uploaded question,uploaded answer\n")
            csv_path = f.name
        try:
            upload_result = langwatch.dataset.upload(
                dataset_slug, file_path=csv_path
            )
            print(f"   Uploaded: {upload_result.recordsCreated} records created")
        finally:
            os.unlink(csv_path)

        # ── 10. Get dataset again (verify records) ──────────
        print("\n10. Verify final state")
        final = langwatch.dataset.get_dataset(dataset_slug)
        print(f"   Dataset has {len(final.entries)} entries")

        # ── 11. to_pandas ───────────────────────────────────
        print("\n11. Convert to pandas")
        try:
            df = final.to_pandas()
            print(f"   DataFrame shape: {df.shape}")
            print(f"   Columns: {list(df.columns)}")
        except ImportError:
            print("   (pandas not installed, skipping)")

        # ── 12. Create dataset from file ────────────────────
        print("\n12. Create dataset from file")
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False
        ) as f:
            f.write("question,answer\n")
            f.write("What color is the sky?,Blue\n")
            f.write("What is 1+1?,2\n")
            csv_path = f.name
        try:
            from_file = langwatch.dataset.create_dataset_from_file(
                "SDK File Upload Test", file_path=csv_path
            )
            print(f"   Created: {from_file.dataset.name} with {from_file.recordsCreated} records")
            # Clean up the file-created dataset
            langwatch.dataset.delete_dataset(from_file.dataset.slug)
            print(f"   Cleaned up: {from_file.dataset.slug}")
        finally:
            os.unlink(csv_path)

        print("\n" + "=" * 60)
        print("All operations completed successfully!")

    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    finally:
        # ── Cleanup: delete test dataset ────────────────────
        if dataset_slug:
            print(f"\nCleaning up: deleting {dataset_slug}")
            try:
                langwatch.dataset.delete_dataset(dataset_slug)
                print("   Deleted.")
            except Exception as e:
                print(f"   Cleanup failed: {e}")


if __name__ == "__main__":
    main()
