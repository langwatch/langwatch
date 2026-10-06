"""batch_evaluation.get_dataset fetches through DatasetApiService."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

pytest.importorskip("pandas")

from langwatch.batch_evaluation import get_dataset


@pytest.mark.unit
def test_fetches_via_dataset_api_service_and_converts_records():
    rows = [
        {"id": "r1", "datasetId": "ds_1", "entry": {"id": "r1", "input": "a", "selected": True}},
        {"id": "r2", "datasetId": "ds_1", "entry": {"input": "b"}},
    ]

    def get(url, params=None):
        if url == "/api/v1/dataset/my%20data/records":
            return httpx.Response(
                200,
                json={
                    "data": rows,
                    "pagination": {"page": 1, "limit": 16, "total": 2, "totalPages": 1},
                },
            )
        assert url == "/api/v1/dataset"
        return httpx.Response(
            200,
            json={
                "data": [{"id": "ds_1", "name": "my data", "slug": "my-data"}],
                "pagination": {"page": 1, "limit": 1000, "total": 1, "totalPages": 1},
            },
        )

    instance = MagicMock()
    http_get = instance.rest_api_client.get_httpx_client.return_value.get
    http_get.side_effect = get

    with patch("langwatch.batch_evaluation.ensure_setup"), patch(
        "langwatch.batch_evaluation.get_instance", return_value=instance
    ):
        records = get_dataset("my data")

    assert http_get.call_args_list[0].args == ("/api/v1/dataset/my%20data/records",)
    assert [r.index for r in records] == [0, 1]
    assert records[0].entry.model_dump() == {"input": "a"}
