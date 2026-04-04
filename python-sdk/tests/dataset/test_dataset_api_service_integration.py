"""
Integration tests for DatasetApiService.

Mocks httpx at the transport boundary to verify HTTP request construction,
response parsing, and error mapping without hitting a real server.

Covers @integration scenarios from dataset-python-sdk.feature.
"""

import json
from unittest.mock import MagicMock

import httpx
import pytest

from langwatch.dataset.dataset_api_service import DatasetApiService, _raise_for_api_status


def _make_mock_client(mock_httpx: MagicMock) -> MagicMock:
    """Create a mock LangWatchRestApiClient whose get_httpx_client() returns mock_httpx."""
    rest_client = MagicMock()
    rest_client.get_httpx_client.return_value = mock_httpx
    return rest_client


def _json_response(data, status_code=200):
    """Build an httpx.Response-like object from a dict."""
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.is_success = 200 <= status_code < 300
    response.json.return_value = data
    response.text = json.dumps(data)
    return response


def _error_response(status_code, message="error"):
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.is_success = False
    response.json.return_value = {"message": message}
    response.text = json.dumps({"message": message})
    return response


@pytest.mark.unit
class TestRaiseForApiStatus:
    """_raise_for_api_status()"""

    def test_passes_on_success(self):
        resp = _json_response({}, 200)
        _raise_for_api_status(resp)  # should not raise

    def test_raises_value_error_on_400(self):
        with pytest.raises(ValueError, match="Bad request"):
            _raise_for_api_status(_error_response(400, "invalid field"))

    def test_raises_runtime_error_on_401(self):
        with pytest.raises(RuntimeError, match="Authentication failed"):
            _raise_for_api_status(_error_response(401, "bad token"))

    def test_raises_value_error_on_404(self):
        with pytest.raises(ValueError, match="Not found"):
            _raise_for_api_status(_error_response(404, "dataset not found"))

    def test_raises_value_error_on_409(self):
        with pytest.raises(ValueError, match="Conflict"):
            _raise_for_api_status(_error_response(409, "already exists"))

    def test_raises_value_error_on_422(self):
        with pytest.raises(ValueError, match="Validation error"):
            _raise_for_api_status(_error_response(422, "bad data"))

    def test_raises_runtime_error_on_500(self):
        with pytest.raises(RuntimeError, match="Server error"):
            _raise_for_api_status(_error_response(500, "internal error"))


@pytest.mark.integration
class TestDatasetApiService:
    """DatasetApiService"""

    class TestListDatasets:
        """list_datasets()"""

        def test_returns_paginated_data(self):
            """@integration Scenario: List datasets returns first page for the project"""
            mock_httpx = MagicMock()
            mock_httpx.get.return_value = _json_response(
                {
                    "data": [
                        {"id": "ds_1", "name": "D1", "slug": "d1", "columnTypes": []},
                        {"id": "ds_2", "name": "D2", "slug": "d2", "columnTypes": []},
                        {"id": "ds_3", "name": "D3", "slug": "d3", "columnTypes": []},
                    ],
                    "pagination": {
                        "page": 1,
                        "limit": 10,
                        "total": 3,
                        "totalPages": 1,
                    },
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.list_datasets()
            assert len(result["data"]) == 3
            assert result["pagination"]["total"] == 3
            mock_httpx.get.assert_called_once_with("/api/dataset", params={})

        def test_passes_pagination_params(self):
            """@integration Scenario: List datasets with explicit pagination"""
            mock_httpx = MagicMock()
            mock_httpx.get.return_value = _json_response(
                {"data": [], "pagination": {"page": 2, "limit": 5, "total": 15, "totalPages": 3}}
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            svc.list_datasets(page=2, limit=5)
            mock_httpx.get.assert_called_once_with(
                "/api/dataset", params={"page": 2, "limit": 5}
            )

        def test_returns_empty_result_when_no_datasets(self):
            """@integration Scenario: List datasets returns empty result when project has no datasets"""
            mock_httpx = MagicMock()
            mock_httpx.get.return_value = _json_response(
                {
                    "data": [],
                    "pagination": {
                        "page": 1,
                        "limit": 10,
                        "total": 0,
                        "totalPages": 0,
                    },
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.list_datasets()
            assert result["data"] == []
            assert result["pagination"]["total"] == 0

        def test_raises_runtime_error_on_auth_failure(self):
            """@integration Scenario: List datasets propagates authentication errors"""
            mock_httpx = MagicMock()
            mock_httpx.get.return_value = _error_response(401, "Invalid API key")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(RuntimeError, match="Authentication failed"):
                svc.list_datasets()

    class TestCreateDataset:
        """create_dataset()"""

        def test_creates_dataset_with_name_and_columns(self):
            """@integration Scenario: Create a dataset with name and column types"""
            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _json_response(
                {
                    "id": "ds_1",
                    "name": "User Feedback",
                    "slug": "user-feedback",
                    "columnTypes": [
                        {"name": "input", "type": "string"},
                        {"name": "output", "type": "string"},
                    ],
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.create_dataset(
                name="User Feedback",
                columns=[
                    {"name": "input", "type": "string"},
                    {"name": "output", "type": "string"},
                ],
            )
            assert result["name"] == "User Feedback"
            assert result["slug"] == "user-feedback"
            assert len(result["columnTypes"]) == 2

        def test_creates_dataset_with_only_name(self):
            """@integration Scenario: Create a dataset with only a name"""
            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _json_response(
                {
                    "id": "ds_2",
                    "name": "Simple Dataset",
                    "slug": "simple-dataset",
                    "columnTypes": [],
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.create_dataset(name="Simple Dataset")
            assert result["columnTypes"] == []

        def test_raises_value_error_on_conflict(self):
            """@integration Scenario: Create a dataset with a conflicting name"""
            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _error_response(409, "Dataset already exists")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Conflict"):
                svc.create_dataset(name="Existing")

    class TestGetDataset:
        """get_dataset()"""

        def test_returns_dataset_with_entries(self):
            """@integration Scenario: Get dataset returns dataset with entries"""
            mock_httpx = MagicMock()
            data = [
                {"id": f"r{i}", "entry": {"input": f"val{i}"}} for i in range(5)
            ]
            mock_httpx.get.return_value = _json_response(
                {"datasetId": "ds_1", "name": "my-dataset", "slug": "my-dataset", "data": data}
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.get_dataset("my-dataset")
            assert len(result["data"]) == 5

        def test_gets_dataset_by_id(self):
            """@integration Scenario: Get dataset by ID works the same as by slug"""
            mock_httpx = MagicMock()
            mock_httpx.get.return_value = _json_response(
                {
                    "datasetId": "dataset_xyz",
                    "name": "my-data",
                    "slug": "my-data",
                    "data": [{"id": "r1", "entry": {"input": "val"}}],
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.get_dataset("dataset_xyz")
            assert result["slug"] == "my-data"
            mock_httpx.get.assert_called_once_with("/api/dataset/dataset_xyz")

        def test_raises_value_error_on_not_found(self):
            """@integration Scenario: Get non-existent dataset raises an error"""
            mock_httpx = MagicMock()
            mock_httpx.get.return_value = _error_response(404, "dataset not found")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Not found"):
                svc.get_dataset("does-not-exist")

    class TestUpdateDataset:
        """update_dataset()"""

        def test_updates_dataset_name(self):
            """@integration Scenario: Update a dataset name"""
            mock_httpx = MagicMock()
            mock_httpx.patch.return_value = _json_response(
                {"id": "ds_1", "name": "New Name", "slug": "new-name", "columnTypes": []}
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.update_dataset("old-name", name="New Name")
            assert result["name"] == "New Name"
            assert result["slug"] == "new-name"

        def test_updates_dataset_column_types(self):
            """@integration Scenario: Update a dataset column types"""
            mock_httpx = MagicMock()
            mock_httpx.patch.return_value = _json_response(
                {
                    "id": "ds_1",
                    "name": "my-dataset",
                    "slug": "my-dataset",
                    "columnTypes": [{"name": "question", "type": "string"}],
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.update_dataset(
                "my-dataset",
                columns=[{"name": "question", "type": "string"}],
            )
            assert result["columnTypes"] == [{"name": "question", "type": "string"}]
            # Verify the body sent to the API
            call_args = mock_httpx.patch.call_args
            assert call_args[1]["json"] == {
                "columnTypes": [{"name": "question", "type": "string"}]
            }

        def test_raises_value_error_on_not_found(self):
            """@integration Scenario: Update a non-existent dataset"""
            mock_httpx = MagicMock()
            mock_httpx.patch.return_value = _error_response(404, "not found")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Not found"):
                svc.update_dataset("ghost", name="Whatever")

    class TestDeleteDataset:
        """delete_dataset()"""

        def test_deletes_without_error(self):
            """@integration Scenario: Delete a dataset archives it"""
            mock_httpx = MagicMock()
            resp = MagicMock(spec=httpx.Response)
            resp.status_code = 200
            resp.is_success = True
            mock_httpx.delete.return_value = resp
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            svc.delete_dataset("to-delete")  # should not raise

        def test_raises_value_error_on_not_found(self):
            """@integration Scenario: Delete a non-existent dataset"""
            mock_httpx = MagicMock()
            mock_httpx.delete.return_value = _error_response(404, "not found")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Not found"):
                svc.delete_dataset("nope")

    class TestListRecords:
        """list_records()"""

        def test_returns_paginated_records(self):
            """@integration Scenario: List records returns paginated records for a dataset"""
            mock_httpx = MagicMock()
            records = [
                {"id": f"rec_{i}", "entry": {"input": f"val{i}"}, "createdAt": "2026-01-01"}
                for i in range(10)
            ]
            mock_httpx.get.return_value = _json_response(
                {
                    "data": records,
                    "pagination": {
                        "page": 1,
                        "limit": 10,
                        "total": 10,
                        "totalPages": 1,
                    },
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.list_records("my-dataset")
            assert len(result["data"]) == 10
            assert result["pagination"]["total"] == 10
            mock_httpx.get.assert_called_once_with(
                "/api/dataset/my-dataset/records", params={}
            )

        def test_passes_pagination_params(self):
            """@integration Scenario: List records with explicit pagination"""
            mock_httpx = MagicMock()
            records = [
                {"id": f"rec_{i}", "entry": {"input": f"val{i}"}, "createdAt": "2026-01-01"}
                for i in range(20)
            ]
            mock_httpx.get.return_value = _json_response(
                {
                    "data": records,
                    "pagination": {
                        "page": 2,
                        "limit": 20,
                        "total": 100,
                        "totalPages": 5,
                    },
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            svc.list_records("my-dataset", page=2, limit=20)
            mock_httpx.get.assert_called_once_with(
                "/api/dataset/my-dataset/records", params={"page": 2, "limit": 20}
            )

        def test_raises_value_error_on_not_found(self):
            """@integration Scenario: List records for non-existent dataset raises an error"""
            mock_httpx = MagicMock()
            mock_httpx.get.return_value = _error_response(404, "dataset not found")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Not found"):
                svc.list_records("ghost")

    class TestCreateRecords:
        """create_records()"""

        def test_adds_records_to_dataset(self):
            """@integration Scenario: Add records to an existing dataset"""
            mock_httpx = MagicMock()
            created_records = [
                {"id": "rec_1", "entry": {"input": "hello", "output": "hi"}, "createdAt": "2026-01-01"},
                {"id": "rec_2", "entry": {"input": "bye", "output": "goodbye"}, "createdAt": "2026-01-01"},
            ]
            mock_httpx.post.return_value = _json_response(
                {"data": created_records}, status_code=201
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.create_records(
                "my-dataset",
                entries=[
                    {"input": "hello", "output": "hi"},
                    {"input": "bye", "output": "goodbye"},
                ],
            )
            assert len(result) == 2
            assert result[0]["id"] == "rec_1"
            assert result[1]["id"] == "rec_2"
            mock_httpx.post.assert_called_once()
            call_url = mock_httpx.post.call_args[0][0]
            assert "/records" in call_url
            assert "/entries" not in call_url

        def test_raises_value_error_on_not_found(self):
            """@integration Scenario: Add records to a non-existent dataset"""
            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _error_response(404, "not found")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Not found"):
                svc.create_records("ghost", entries=[{"input": "x"}])

    class TestUpdateRecord:
        """update_record()"""

        def test_updates_single_record(self):
            """@integration Scenario: Update a single record"""
            mock_httpx = MagicMock()
            mock_httpx.patch.return_value = _json_response(
                {"id": "rec-1", "datasetId": "ds_1", "entry": {"input": "updated"}}
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.update_record(
                "my-dataset", "rec-1", entry={"input": "updated"}
            )
            assert result["entry"] == {"input": "updated"}

        def test_upserts_non_existent_record(self):
            """@integration Scenario: Update a non-existent record creates it"""
            mock_httpx = MagicMock()
            mock_httpx.patch.return_value = _json_response(
                {"id": "rec-new", "datasetId": "ds_1", "entry": {"input": "new"}}
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.update_record(
                "my-dataset", "rec-new", entry={"input": "new"}
            )
            assert result["id"] == "rec-new"
            assert result["entry"] == {"input": "new"}
            mock_httpx.patch.assert_called_once_with(
                "/api/dataset/my-dataset/records/rec-new",
                json={"entry": {"input": "new"}},
            )

        def test_raises_value_error_on_not_found(self):
            """@integration Scenario: Update a record for non-existent dataset"""
            mock_httpx = MagicMock()
            mock_httpx.patch.return_value = _error_response(404, "not found")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Not found"):
                svc.update_record("ghost", "rec-1", entry={"input": "x"})

    class TestDeleteRecords:
        """delete_records()"""

        def test_deletes_records_by_ids(self):
            """@integration Scenario: Delete records by IDs"""
            mock_httpx = MagicMock()
            mock_httpx.request.return_value = _json_response({"deletedCount": 2})
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.delete_records(
                "my-dataset", record_ids=["rec-1", "rec-2"]
            )
            assert result == 2

        def test_raises_value_error_on_not_found(self):
            """@integration Scenario: Delete records for non-existent dataset"""
            mock_httpx = MagicMock()
            mock_httpx.request.return_value = _error_response(404, "not found")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Not found"):
                svc.delete_records("ghost", record_ids=["rec-1"])

    class TestUpload:
        """upload()"""

        def test_uploads_file_to_existing_dataset(self, tmp_path):
            """@integration Scenario: Upload a CSV file to an existing dataset"""
            csv_file = tmp_path / "data.csv"
            csv_file.write_text("input,output\nhello,hi\nbye,goodbye\nfoo,bar")

            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _json_response(
                {"datasetId": "ds_1", "recordsCreated": 3}
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.upload("my-dataset", file_path=str(csv_file))
            assert result["recordsCreated"] == 3
            mock_httpx.post.assert_called_once()

        def test_uploads_jsonl_file_to_existing_dataset(self, tmp_path):
            """@integration Scenario: Upload a JSONL file to an existing dataset"""
            jsonl_file = tmp_path / "data.jsonl"
            jsonl_file.write_text(
                '{"input": "hello", "output": "hi"}\n'
                '{"input": "bye", "output": "goodbye"}\n'
            )

            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _json_response(
                {"datasetId": "ds_1", "recordsCreated": 2}
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.upload("my-dataset", file_path=str(jsonl_file))
            assert result["recordsCreated"] == 2
            mock_httpx.post.assert_called_once()

        def test_raises_value_error_on_not_found(self, tmp_path):
            """@integration Scenario: Upload to a non-existent dataset"""
            csv_file = tmp_path / "data.csv"
            csv_file.write_text("input\nhello")

            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _error_response(404, "not found")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Not found"):
                svc.upload("ghost", file_path=str(csv_file))

    class TestCreateDatasetFromFile:
        """create_dataset_from_file()"""

        def test_creates_dataset_from_csv(self, tmp_path):
            """@integration Scenario: Create a dataset from a CSV file"""
            csv_file = tmp_path / "feedback.csv"
            csv_file.write_text("question,answer\nq1,a1\nq2,a2\nq3,a3\nq4,a4\nq5,a5")

            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _json_response(
                {
                    "dataset": {
                        "id": "ds_1",
                        "name": "From CSV",
                        "slug": "from-csv",
                        "columnTypes": [],
                    },
                    "recordsCreated": 5,
                }
            )
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            result = svc.create_dataset_from_file(
                name="From CSV", file_path=str(csv_file)
            )
            assert result["recordsCreated"] == 5
            assert result["dataset"]["name"] == "From CSV"

        def test_raises_value_error_on_conflict(self, tmp_path):
            """@integration Scenario: Create dataset from file with conflicting name"""
            csv_file = tmp_path / "data.csv"
            csv_file.write_text("input\nhello")

            mock_httpx = MagicMock()
            mock_httpx.post.return_value = _error_response(409, "already exists")
            svc = DatasetApiService(_make_mock_client(mock_httpx))
            with pytest.raises(ValueError, match="Conflict"):
                svc.create_dataset_from_file(name="Existing", file_path=str(csv_file))


@pytest.mark.integration
class TestSDKInitialization:
    """SDK initialization"""

    def test_auto_initializes_from_environment_variables(self, monkeypatch):
        """@integration Scenario: SDK auto-initializes from environment variables"""
        import langwatch.dataset as dataset_module

        monkeypatch.setenv("LANGWATCH_API_KEY", "fake-key")

        # Reset the cached facade so from_global() is called
        dataset_module._facade_instance = None

        mock_facade = MagicMock()
        mock_facade.list_datasets.return_value = MagicMock(
            data=[], pagination=MagicMock(total=0)
        )

        # Patch from_global to return our mock facade (avoids real HTTP calls)
        monkeypatch.setattr(
            dataset_module.DatasetsFacade,
            "from_global",
            classmethod(lambda cls: mock_facade),
        )

        dataset_module.list_datasets()
        mock_facade.list_datasets.assert_called_once()

    def test_raises_error_when_no_api_key(self, monkeypatch):
        """@integration Scenario: SDK raises error when no API key is available"""
        import langwatch.dataset as dataset_module
        from langwatch.dataset.dataset_facade import DatasetsFacade

        monkeypatch.delenv("LANGWATCH_API_KEY", raising=False)

        # Reset state so from_global() is triggered fresh
        dataset_module._facade_instance = None

        monkeypatch.setattr(
            "langwatch.dataset.dataset_facade.ensure_setup", lambda: None
        )
        monkeypatch.setattr(
            "langwatch.dataset.dataset_facade.get_instance", lambda: None
        )

        with pytest.raises(RuntimeError, match="LANGWATCH_API_KEY"):
            DatasetsFacade.from_global()
