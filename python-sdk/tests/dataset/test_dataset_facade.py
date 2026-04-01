"""
Unit tests for DatasetsFacade client-side validation logic.

Covers:
  - @unit Scenario: Create dataset validates that name is not empty
  - @unit Scenario: Create records validates entries is not empty
  - @unit Scenario: Delete records validates record_ids is not empty
  - @unit Scenario: Upload validates that file exists
  - @unit Scenario: Upload validates supported file extensions
"""

import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from langwatch.dataset.dataset_facade import DatasetsFacade


@pytest.fixture
def facade():
    """Create a DatasetsFacade with a mocked REST API client."""
    mock_client = MagicMock()
    return DatasetsFacade(mock_client)


class TestDatasetsFacade:
    """DatasetsFacade"""

    class TestCreateDataset:
        """create_dataset()"""

        def test_raises_value_error_when_name_is_empty(self, facade):
            """@unit Scenario: Create dataset validates that name is not empty"""
            with pytest.raises(ValueError, match="name is required"):
                facade.create_dataset("")

        def test_raises_value_error_when_name_is_whitespace(self, facade):
            with pytest.raises(ValueError, match="name is required"):
                facade.create_dataset("   ")

    class TestCreateRecords:
        """create_records()"""

        def test_raises_value_error_when_entries_is_empty(self, facade):
            """@unit Scenario: Create records validates entries is not empty"""
            with pytest.raises(ValueError, match="Entries must not be empty"):
                facade.create_records("my-dataset", entries=[])

        def test_returns_none(self, facade):
            """create_records() returns None"""
            facade._api.create_records = MagicMock(return_value=None)
            result = facade.create_records(
                "my-dataset", entries=[{"input": "hello"}]
            )
            assert result is None

    class TestDeleteRecords:
        """delete_records()"""

        def test_raises_value_error_when_record_ids_is_empty(self, facade):
            """@unit Scenario: Delete records validates record_ids is not empty"""
            with pytest.raises(ValueError, match="record_ids must not be empty"):
                facade.delete_records("my-dataset", record_ids=[])

        def test_returns_deleted_count_as_int(self, facade):
            """delete_records() returns int (deleted count)"""
            facade._api.delete_records = MagicMock(return_value=3)
            result = facade.delete_records(
                "my-dataset", record_ids=["r1", "r2", "r3"]
            )
            assert result == 3
            assert isinstance(result, int)

    class TestUpload:
        """upload()"""

        def test_raises_file_not_found_when_file_missing(self, facade):
            """@unit Scenario: Upload validates that file exists"""
            with pytest.raises(FileNotFoundError):
                facade.upload("my-dataset", file_path="nonexistent.csv")

        def test_raises_value_error_for_unsupported_extension(self, facade):
            """@unit Scenario: Upload validates supported file extensions"""
            with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
                tmp_path = f.name
            try:
                with pytest.raises(ValueError, match="Unsupported file format"):
                    facade.upload("my-dataset", file_path=tmp_path)
            finally:
                os.unlink(tmp_path)

        def test_accepts_csv_extension(self, facade):
            """CSV files are accepted by validation."""
            with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as f:
                tmp_path = f.name
            try:
                # Should not raise FileNotFoundError or ValueError for extension
                # Will raise from the API call since we have a mock, but that's fine
                facade._api.upload = MagicMock(
                    return_value={"datasetId": "ds_1", "recordsCreated": 1}
                )
                result = facade.upload("my-dataset", file_path=tmp_path)
                assert result.recordsCreated == 1
            finally:
                os.unlink(tmp_path)

        def test_accepts_jsonl_extension(self, facade):
            """JSONL files are accepted by validation."""
            with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
                tmp_path = f.name
            try:
                facade._api.upload = MagicMock(
                    return_value={"datasetId": "ds_1", "recordsCreated": 2}
                )
                result = facade.upload("my-dataset", file_path=tmp_path)
                assert result.recordsCreated == 2
            finally:
                os.unlink(tmp_path)

    class TestCreateDatasetFromFile:
        """create_dataset_from_file()"""

        def test_raises_value_error_when_name_is_empty(self, facade):
            with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as f:
                tmp_path = f.name
            try:
                with pytest.raises(ValueError, match="name is required"):
                    facade.create_dataset_from_file("", file_path=tmp_path)
            finally:
                os.unlink(tmp_path)

        def test_raises_file_not_found_when_file_missing(self, facade):
            with pytest.raises(FileNotFoundError):
                facade.create_dataset_from_file("Test", file_path="nonexistent.csv")

    class TestListDatasets:
        """list_datasets()"""

        def test_returns_paginated_result(self, facade):
            facade._api.list_datasets = MagicMock(
                return_value={
                    "data": [
                        {
                            "id": "ds_1",
                            "name": "Dataset 1",
                            "slug": "dataset-1",
                            "columnTypes": [],
                        }
                    ],
                    "pagination": {
                        "page": 1,
                        "limit": 10,
                        "total": 1,
                        "totalPages": 1,
                    },
                }
            )
            result = facade.list_datasets()
            assert len(result.data) == 1
            assert result.data[0].name == "Dataset 1"
            assert result.pagination.total == 1

        def test_returns_empty_result(self, facade):
            """list_datasets() returns empty .data and .pagination.total is 0"""
            facade._api.list_datasets = MagicMock(
                return_value={
                    "data": [],
                    "pagination": {
                        "page": 1,
                        "limit": 10,
                        "total": 0,
                        "totalPages": 0,
                    },
                }
            )
            result = facade.list_datasets()
            assert result.data == []
            assert result.pagination.total == 0

    class TestGetDataset:
        """get_dataset()"""

        def test_returns_dataset_with_entries(self, facade):
            facade._api.get_dataset = MagicMock(
                return_value={
                    "datasetId": "ds_1",
                    "name": "My Dataset",
                    "slug": "my-dataset",
                    "data": [
                        {"id": "r1", "entry": {"input": "hello"}},
                        {"id": "r2", "entry": {"input": "bye"}},
                    ],
                }
            )
            ds = facade.get_dataset("my-dataset")
            assert len(ds.entries) == 2
            assert ds.entries[0].id == "r1"
            assert ds.entries[0].entry == {"input": "hello"}

        def test_gets_dataset_by_id(self, facade):
            """get_dataset() by ID works the same as by slug"""
            facade._api.get_dataset = MagicMock(
                return_value={
                    "datasetId": "dataset_xyz",
                    "name": "my-data",
                    "slug": "my-data",
                    "data": [],
                }
            )
            ds = facade.get_dataset("dataset_xyz")
            assert ds.slug == "my-data"
            assert ds.id == "dataset_xyz"
            facade._api.get_dataset.assert_called_once_with("dataset_xyz")

    class TestUpdateDataset:
        """update_dataset()"""

        def test_returns_dataset_info(self, facade):
            facade._api.update_dataset = MagicMock(
                return_value={
                    "id": "ds_1",
                    "name": "New Name",
                    "slug": "new-name",
                    "columnTypes": [],
                }
            )
            info = facade.update_dataset("old-name", name="New Name")
            assert info.name == "New Name"
            assert info.slug == "new-name"

        def test_updates_column_types(self, facade):
            """update_dataset() with column types returns updated DatasetInfo"""
            facade._api.update_dataset = MagicMock(
                return_value={
                    "id": "ds_1",
                    "name": "my-dataset",
                    "slug": "my-dataset",
                    "columnTypes": [{"name": "question", "type": "string"}],
                }
            )
            info = facade.update_dataset(
                "my-dataset",
                columns=[{"name": "question", "type": "string"}],
            )
            assert len(info.columnTypes) == 1
            assert info.columnTypes[0].name == "question"
            assert info.columnTypes[0].type == "string"

    class TestDeleteDataset:
        """delete_dataset()"""

        def test_completes_without_error(self, facade):
            facade._api.delete_dataset = MagicMock(return_value=None)
            # Should not raise
            facade.delete_dataset("to-delete")
            facade._api.delete_dataset.assert_called_once_with("to-delete")

    class TestUpdateRecord:
        """update_record()"""

        def test_returns_dataset_record(self, facade):
            facade._api.update_record = MagicMock(
                return_value={
                    "id": "rec-1",
                    "datasetId": "ds_1",
                    "entry": {"input": "updated"},
                }
            )
            record = facade.update_record(
                "my-dataset", "rec-1", entry={"input": "updated"}
            )
            assert record.id == "rec-1"
            assert record.entry == {"input": "updated"}

        def test_upserts_non_existent_record(self, facade):
            """update_record() for non-existent record creates it (upsert)"""
            facade._api.update_record = MagicMock(
                return_value={
                    "id": "rec-new",
                    "datasetId": "ds_1",
                    "entry": {"input": "new"},
                }
            )
            record = facade.update_record(
                "my-dataset", "rec-new", entry={"input": "new"}
            )
            assert record.id == "rec-new"
            assert record.entry == {"input": "new"}
