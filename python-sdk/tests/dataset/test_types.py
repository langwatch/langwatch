"""
Unit tests for dataset Pydantic models.

Covers:
  - @unit Scenario: Dataset object exposes entries as list of DatasetEntry
  - @unit Scenario: Dataset.to_pandas converts entries to a DataFrame
  - @unit Scenario: DatasetInfo object exposes dataset metadata without records
  - @unit Scenario: PaginatedResult exposes data list and pagination metadata
"""

import pytest
from langwatch.dataset.types import (
    ColumnType,
    Dataset,
    DatasetEntry,
    DatasetInfo,
    DatasetRecord,
    PaginatedResult,
    Pagination,
    UploadResult,
    CreateFromFileResult,
)


class TestDatasetEntry:
    """DatasetEntry"""

    def test_constructs_with_id_and_entry(self):
        entry = DatasetEntry(id="e1", entry={"input": "hello", "output": "hi"})
        assert entry.id == "e1"
        assert entry.entry == {"input": "hello", "output": "hi"}

    def test_ignores_unknown_fields(self):
        entry = DatasetEntry(id="e1", entry={"a": 1}, unknown_field="ignored")
        assert entry.id == "e1"


class TestDataset:
    """Dataset"""

    def test_exposes_entries_as_list_of_dataset_entry(self):
        """@unit Scenario: Dataset object exposes entries as list of DatasetEntry"""
        raw_records = [
            {"id": "r1", "entry": {"input": "a"}},
            {"id": "r2", "entry": {"input": "b"}},
            {"id": "r3", "entry": {"input": "c"}},
        ]
        entries = [DatasetEntry(**r) for r in raw_records]
        ds = Dataset(entries=entries)
        assert len(ds.entries) == 3
        for entry in ds.entries:
            assert hasattr(entry, "id")
            assert hasattr(entry, "entry")

    def test_to_pandas_converts_entries_to_dataframe(self):
        """@unit Scenario: Dataset.to_pandas converts entries to a DataFrame"""
        entries = [
            DatasetEntry(id="1", entry={"input": "hello", "output": "hi"}),
            DatasetEntry(id="2", entry={"input": "bye", "output": "goodbye"}),
        ]
        ds = Dataset(entries=entries)
        df = ds.to_pandas()

        assert len(df) == 2
        assert list(df.columns) == ["input", "output"]
        assert df.iloc[0]["input"] == "hello"
        assert df.iloc[1]["output"] == "goodbye"


class TestDatasetInfo:
    """DatasetInfo"""

    def test_exposes_metadata_without_records(self):
        """@unit Scenario: DatasetInfo object exposes dataset metadata without records"""
        info = DatasetInfo(
            id="ds_1",
            name="Test Dataset",
            slug="test-dataset",
            columnTypes=[ColumnType(name="input", type="string")],
            createdAt="2025-01-01T00:00:00Z",
            updatedAt="2025-01-02T00:00:00Z",
        )
        assert info.id == "ds_1"
        assert info.name == "Test Dataset"
        assert info.slug == "test-dataset"
        assert len(info.columnTypes) == 1
        assert info.columnTypes[0].name == "input"
        assert info.columnTypes[0].type == "string"
        # DatasetInfo has no entries attribute (it's metadata only)
        assert not hasattr(info, "entries")

    def test_column_types_default_to_empty(self):
        info = DatasetInfo(id="ds_1", name="X", slug="x")
        assert info.columnTypes == []

    def test_ignores_unknown_fields(self):
        info = DatasetInfo(
            id="ds_1",
            name="X",
            slug="x",
            randomStuff="ignored",
        )
        assert info.id == "ds_1"

    def test_record_count_optional(self):
        info = DatasetInfo(id="ds_1", name="X", slug="x", recordCount=42)
        assert info.recordCount == 42


class TestPaginatedResult:
    """PaginatedResult"""

    def test_exposes_data_list_and_pagination_metadata(self):
        """@unit Scenario: PaginatedResult exposes data list and pagination metadata"""
        items = [
            DatasetInfo(id=f"ds_{i}", name=f"Dataset {i}", slug=f"dataset-{i}")
            for i in range(3)
        ]
        pagination = Pagination(page=1, limit=10, total=10, totalPages=1)
        result = PaginatedResult[DatasetInfo](data=items, pagination=pagination)

        assert len(result.data) == 3
        assert result.pagination.total == 10
        assert result.pagination.page == 1
        assert result.pagination.limit == 10
        assert result.pagination.totalPages == 1


class TestDatasetRecord:
    """DatasetRecord"""

    def test_constructs_with_all_fields(self):
        record = DatasetRecord(
            id="rec-1",
            datasetId="ds_1",
            projectId="proj_1",
            entry={"input": "hello"},
            createdAt="2025-01-01T00:00:00Z",
            updatedAt="2025-01-02T00:00:00Z",
        )
        assert record.id == "rec-1"
        assert record.entry == {"input": "hello"}

    def test_optional_fields_default_to_none(self):
        record = DatasetRecord(id="rec-1")
        assert record.datasetId is None
        assert record.projectId is None
        assert record.entry == {}


class TestUploadResult:
    """UploadResult"""

    def test_constructs_with_fields(self):
        result = UploadResult(datasetId="ds_1", recordsCreated=5)
        assert result.datasetId == "ds_1"
        assert result.recordsCreated == 5


class TestCreateFromFileResult:
    """CreateFromFileResult"""

    def test_constructs_with_dataset_and_count(self):
        info = DatasetInfo(id="ds_1", name="From CSV", slug="from-csv")
        result = CreateFromFileResult(dataset=info, recordsCreated=10)
        assert result.dataset.name == "From CSV"
        assert result.recordsCreated == 10


class TestColumnType:
    """ColumnType"""

    def test_constructs_with_name_and_type(self):
        col = ColumnType(name="input", type="string")
        assert col.name == "input"
        assert col.type == "string"
