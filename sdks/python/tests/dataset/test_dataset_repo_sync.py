"""
Keeping a dataset in sync with files held in a repository.

create_dataset() sends columns and rows in one call; upsert_records() updates
the row whose key column matches instead of appending a copy. A fake server
behind an httpx MockTransport holds the dataset and records every request.

Spec: modules/dataset/specs/dataset-repo-sync.feature
"""

import json
from typing import Any, Dict, List
from unittest.mock import MagicMock

import httpx
import pytest

from langwatch.dataset.dataset_api_service import DatasetApiService
from langwatch.dataset.dataset_facade import DatasetsFacade
from langwatch.dataset.errors import DatasetUpsertKeyError

pytestmark = pytest.mark.unit

DATASET = {
    "id": "dataset_qa",
    "name": "QA cases",
    "slug": "qa-cases",
    "columnTypes": [
        {"name": "case_id", "type": "string"},
        {"name": "input", "type": "string"},
        {"name": "expected_output", "type": "string"},
    ],
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z",
    "platformUrl": "https://app.langwatch.ai/acme/datasets/dataset_qa",
}


class FakeDatasetServer:
    """The dataset routes a sync uses, over rows held in memory."""

    def __init__(self, rows: List[Dict[str, Any]]) -> None:
        self.rows = [
            {"id": f"rec_{index}", "entry": dict(entry)}
            for index, entry in enumerate(rows)
        ]
        self.requests: List[str] = []
        self.bodies: List[Dict[str, Any]] = []

    def record(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "datasetId": DATASET["id"],
            "projectId": "project_1",
            "entry": row["entry"],
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append(f"{request.method} {path}")
        body = json.loads(request.content) if request.content else {}
        if body:
            self.bodies.append(body)
        records_path = f"/api/v1/dataset/{DATASET['slug']}/records"

        if request.method == "POST" and path == "/api/v1/dataset":
            return httpx.Response(201, json={**DATASET, "name": body["name"]})

        if request.method == "GET" and path == records_path:
            page = int(request.url.params.get("page", "1"))
            limit = int(request.url.params.get("limit", "50"))
            start = (page - 1) * limit
            rows = self.rows[start : start + limit]
            total = len(self.rows)
            return httpx.Response(
                200,
                json={
                    "data": [self.record(row) for row in rows],
                    "pagination": {
                        "page": page,
                        "limit": limit,
                        "total": total,
                        "totalPages": -(-total // limit),
                    },
                    "dataset": DATASET,
                },
            )

        if request.method == "POST" and path == records_path:
            created = []
            for entry in body["entries"]:
                row = {"id": f"rec_{len(self.rows)}", "entry": dict(entry)}
                self.rows.append(row)
                created.append(self.record(row))
            return httpx.Response(201, json={"data": created})

        if request.method == "PATCH" and path.startswith(records_path + "/"):
            record_id = path.rsplit("/", 1)[1]
            row = next(row for row in self.rows if row["id"] == record_id)
            row["entry"] = dict(body["entry"])
            return httpx.Response(200, json=self.record(row))

        return httpx.Response(404, json={"error": "Not Found"})

    def writes(self) -> List[str]:
        return [r for r in self.requests if not r.startswith("GET ")]


def _facade(server: FakeDatasetServer) -> DatasetsFacade:
    rest_client = MagicMock()
    rest_client.get_httpx_client.return_value = httpx.Client(
        transport=httpx.MockTransport(server.handle), base_url="http://langwatch.test"
    )
    facade = DatasetsFacade(MagicMock())
    facade._api = DatasetApiService(rest_client)
    return facade


COLUMNS = [
    {"name": "case_id", "type": "string"},
    {"name": "input", "type": "string"},
    {"name": "expected_output", "type": "string"},
]


class TestCreateDatasetWithRecords:
    """create_dataset(records=...)"""

    # @scenario "The SDKs create a dataset with its columns and rows in one call"
    def test_sends_columns_and_entries_in_one_request(self):
        server = FakeDatasetServer(rows=[])
        rows = [
            {"case_id": "c-1", "input": "hi", "expected_output": "hello"},
            {"case_id": "c-2", "input": "bye", "expected_output": "goodbye"},
        ]

        info = _facade(server).create_dataset("QA cases", columns=COLUMNS, records=rows)

        assert info.slug == "qa-cases"
        assert server.requests == ["POST /api/v1/dataset"]
        assert server.bodies == [
            {"name": "QA cases", "columnTypes": COLUMNS, "entries": rows}
        ]

    def test_sends_no_entries_key_when_no_records_are_given(self):
        server = FakeDatasetServer(rows=[])

        _facade(server).create_dataset("QA cases", columns=COLUMNS)

        assert server.bodies == [{"name": "QA cases", "columnTypes": COLUMNS}]


class TestUpsertRecords:
    """upsert_records(key=...)"""

    def _server(self) -> FakeDatasetServer:
        return FakeDatasetServer(
            rows=[
                {"case_id": "c-1", "input": "hi", "expected_output": "hello"},
                {"case_id": "c-2", "input": "bye", "expected_output": "goodbye"},
            ]
        )

    # @scenario "Upserting by a key column updates the matching row instead of appending a copy"
    def test_updates_the_matching_row_in_place(self):
        server = self._server()

        result = _facade(server).upsert_records(
            "qa-cases",
            entries=[{"case_id": "c-1", "input": "hi", "expected_output": "hey there"}],
            key="case_id",
        )

        assert server.writes() == ["PATCH /api/v1/dataset/qa-cases/records/rec_0"]
        assert [r.id for r in result.updated] == ["rec_0"]
        assert result.created == []
        assert len(server.rows) == 2
        assert server.rows[0]["entry"]["expected_output"] == "hey there"

    def test_keeps_columns_the_entry_does_not_send(self):
        server = self._server()

        _facade(server).upsert_records(
            "qa-cases",
            entries=[{"case_id": "c-2", "expected_output": "see you"}],
            key="case_id",
        )

        assert server.rows[1]["entry"] == {
            "case_id": "c-2",
            "input": "bye",
            "expected_output": "see you",
        }

    # @scenario "Upserting by a key column adds the rows whose key is new"
    def test_creates_new_keys_in_one_batch(self):
        server = self._server()

        result = _facade(server).upsert_records(
            "qa-cases",
            entries=[
                {"case_id": "c-8", "input": "a", "expected_output": "b"},
                {"case_id": "c-9", "input": "c", "expected_output": "d"},
            ],
            key="case_id",
        )

        assert server.writes() == ["POST /api/v1/dataset/qa-cases/records"]
        assert [r.entry["case_id"] for r in result.created] == ["c-8", "c-9"]
        assert len(server.rows) == 4

    # @scenario "Upserting by a key column leaves unchanged rows alone"
    def test_sends_nothing_for_an_unchanged_row(self):
        server = self._server()

        result = _facade(server).upsert_records(
            "qa-cases",
            entries=[{"case_id": "c-1", "input": "hi", "expected_output": "hello"}],
            key="case_id",
        )

        assert server.writes() == []
        assert result.unchanged == 1
        assert result.created == [] and result.updated == []

    def test_a_second_run_of_the_same_rows_writes_nothing(self):
        server = self._server()
        facade = _facade(server)
        rows = [
            {"case_id": "c-1", "input": "hi", "expected_output": "hey"},
            {"case_id": "c-3", "input": "new", "expected_output": "row"},
        ]

        facade.upsert_records("qa-cases", entries=rows, key="case_id")
        writes_after_first_run = len(server.writes())
        second = facade.upsert_records("qa-cases", entries=rows, key="case_id")

        assert len(server.writes()) == writes_after_first_run
        assert second.unchanged == 2
        assert len(server.rows) == 3

    # @scenario "Upserting by a key column refuses a key that matches more than one row"
    def test_refuses_a_key_held_by_two_rows(self):
        server = FakeDatasetServer(
            rows=[
                {"case_id": "c-1", "input": "hi", "expected_output": "hello"},
                {"case_id": "c-1", "input": "hi", "expected_output": "hello again"},
            ]
        )

        with pytest.raises(DatasetUpsertKeyError) as refused:
            _facade(server).upsert_records(
                "qa-cases",
                entries=[{"case_id": "c-1", "expected_output": "x"}],
                key="case_id",
            )

        assert refused.value.code == "dataset_has_duplicate_key"
        assert server.writes() == []

    # @scenario "Upserting by a key column refuses two entries with the same key"
    def test_refuses_two_entries_with_the_same_key(self):
        server = self._server()

        with pytest.raises(DatasetUpsertKeyError) as refused:
            _facade(server).upsert_records(
                "qa-cases",
                entries=[{"case_id": "c-5"}, {"case_id": "c-5"}],
                key="case_id",
            )

        assert refused.value.code == "duplicate_upsert_key"
        assert server.requests == []

    # @scenario "Upserting by a key column refuses an entry without the key"
    def test_refuses_an_entry_without_the_key(self):
        server = self._server()

        with pytest.raises(DatasetUpsertKeyError) as refused:
            _facade(server).upsert_records(
                "qa-cases", entries=[{"input": "no key"}], key="case_id"
            )

        assert refused.value.code == "missing_upsert_key"
        assert server.requests == []
