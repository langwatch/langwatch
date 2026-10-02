"""batch_evaluation.get_dataset fetches through DatasetApiService."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

pytest.importorskip("pandas")

from langwatch.batch_evaluation import get_dataset


@pytest.mark.unit
def test_fetches_via_dataset_api_service_and_converts_records():
    response = MagicMock(spec=httpx.Response)
    response.is_success = True
    response.json.return_value = {
        "data": [
            {"id": "r1", "entry": {"id": "r1", "input": "a", "selected": True}},
            {"id": "r2", "entry": {"input": "b"}},
        ]
    }
    instance = MagicMock()
    instance.rest_api_client.get_httpx_client.return_value.get.return_value = response

    with patch("langwatch.batch_evaluation.ensure_setup"), patch(
        "langwatch.batch_evaluation.get_instance", return_value=instance
    ):
        records = get_dataset("my data")

    http_get = instance.rest_api_client.get_httpx_client.return_value.get
    http_get.assert_called_once_with("/api/v1/dataset/my%20data")
    assert [r.index for r in records] == [0, 1]
    assert records[0].entry.model_dump() == {"input": "a"}
