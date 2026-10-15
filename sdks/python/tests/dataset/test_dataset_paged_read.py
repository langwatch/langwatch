"""
get_dataset() reads a dataset page by page.

A fake server behind an httpx MockTransport serves the records endpoint, the
datasets list and the single-response endpoint, and refuses the last one above
its size cap the way the platform does.
"""

import json
from typing import Any, Callable, Dict, List, Optional
from unittest.mock import MagicMock

import httpx
import pytest

from langwatch.dataset.dataset_api_service import DatasetApiService
from langwatch.dataset.dataset_facade import DatasetsFacade
from langwatch.dataset.errors import DatasetApiError, DatasetNotFoundError

pytestmark = pytest.mark.unit

MB = 1024 * 1024
SINGLE_RESPONSE_CAP_BYTES = 25 * MB

DATASET = {
    "id": "dataset_images",
    "name": "Product images",
    "slug": "product-images",
    "columnTypes": [{"name": "image", "type": "image"}],
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-02T00:00:00.000Z",
    "platformUrl": "https://app.langwatch.ai/acme/datasets/dataset_images",
}


class FakeDatasetServer:
    """The three dataset read routes, with rows generated only when a page asks for them."""

    def __init__(
        self,
        *,
        row_count: int,
        row_bytes: Callable[[int], int],
        page_cap_bytes: Optional[int] = None,
        has_records_endpoint: bool = True,
        sends_dataset_with_pages: bool = True,
        suggests_limit: bool = True,
        refuses_single_rows: bool = False,
        lists_dataset: bool = True,
        row_count_after_first_page: Optional[int] = None,
    ) -> None:
        self.row_count = row_count
        self.row_bytes = row_bytes
        self.page_cap_bytes = page_cap_bytes
        self.has_records_endpoint = has_records_endpoint
        self.sends_dataset_with_pages = sends_dataset_with_pages
        self.suggests_limit = suggests_limit
        self.refuses_single_rows = refuses_single_rows
        self.lists_dataset = lists_dataset
        self.row_count_after_first_page = row_count_after_first_page
        self.requests: List[str] = []
        self.record_pages: List[Dict[str, int]] = []
        self.refused_pages: List[Dict[str, int]] = []

    def row(self, index: int) -> Dict[str, Any]:
        return {
            "id": f"rec_{index}",
            "datasetId": DATASET["id"],
            "projectId": "project_1",
            "entry": {"index": index, "image": "x" * self.row_bytes(index)},
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-01T00:00:00.000Z",
        }

    def total_bytes(self) -> int:
        return sum(self.row_bytes(i) for i in range(self.row_count))

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append(f"{request.method} {path}")
        slugs = (DATASET["slug"], DATASET["id"])

        if path == "/api/v1/dataset":
            return httpx.Response(
                200,
                json={
                    "data": (
                        [{**DATASET, "recordCount": self.row_count}]
                        if self.lists_dataset
                        else []
                    ),
                    "pagination": {"page": 1, "limit": 1000, "total": 1, "totalPages": 1},
                },
            )

        if path in [f"/api/v1/dataset/{slug}/records" for slug in slugs]:
            if not self.has_records_endpoint:
                return httpx.Response(404, json={"error": "Not Found"})
            return self._records_page(request)

        if path in [f"/api/v1/dataset/{slug}" for slug in slugs]:
            if self.total_bytes() > SINGLE_RESPONSE_CAP_BYTES:
                return httpx.Response(
                    400,
                    json={
                        "code": "dataset_too_large_to_read_inline",
                        "message": "This dataset is larger than the 27.7 MB one response carries.",
                    },
                )
            rows = [self.row(i) for i in range(self.row_count)]
            return httpx.Response(200, json={**DATASET, "data": rows})

        return httpx.Response(404, json={"error": "Not Found"})

    def _records_page(self, request: httpx.Request) -> httpx.Response:
        page = int(request.url.params.get("page", "1"))
        limit = int(request.url.params.get("limit", "50"))
        start = (page - 1) * limit
        end = min(start + limit, self.row_count)
        asked = {"page": page, "limit": limit}

        page_bytes = sum(self.row_bytes(i) for i in range(start, end))
        too_large = self.page_cap_bytes is not None and page_bytes > self.page_cap_bytes
        if too_large and (end - start > 1 or self.refuses_single_rows):
            self.refused_pages.append(asked)
            meta: Dict[str, Any] = {"page": page, "limit": limit}
            if self.suggests_limit:
                # The largest power of two of rows that fits, as the platform's
                # divisor rule gives for the page sizes the SDK asks for.
                suggested = limit
                while suggested > 1 and (
                    sum(self.row_bytes(i) for i in range(start, start + suggested))
                    > self.page_cap_bytes
                ):
                    suggested //= 2
                meta["suggestedLimit"] = suggested
                meta["suggestedPage"] = start // suggested + 1
            return httpx.Response(
                413,
                json={
                    "code": "dataset_page_too_large",
                    "message": "This page of records is too large for one response.",
                    "meta": meta,
                },
            )

        self.record_pages.append(asked)
        total = self.row_count
        body: Dict[str, Any] = {
            "data": [self.row(i) for i in range(start, end)],
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": -(-total // limit),
            },
        }
        if self.sends_dataset_with_pages:
            body["dataset"] = DATASET
        if self.row_count_after_first_page is not None:
            self.row_count = self.row_count_after_first_page
        return httpx.Response(200, content=json.dumps(body))


def _service(server: FakeDatasetServer) -> DatasetApiService:
    rest_client = MagicMock()
    rest_client.get_httpx_client.return_value = httpx.Client(
        transport=httpx.MockTransport(server.handle), base_url="http://langwatch.test"
    )
    return DatasetApiService(rest_client)


def _facade(server: FakeDatasetServer) -> DatasetsFacade:
    facade = DatasetsFacade(MagicMock())
    facade._api = _service(server)
    return facade


class TestGetDatasetPagedRead:
    """get_dataset()"""

    class TestWhenTheDatasetIsLargerThanTheSingleResponseLimit:
        """when the dataset is larger than the single response limit"""

        # @scenario "Get dataset reads a dataset larger than the single response limit page by page"
        def test_returns_every_row_in_order_without_the_single_request(self):
            server = FakeDatasetServer(row_count=40, row_bytes=lambda _: MB)
            assert server.total_bytes() > SINGLE_RESPONSE_CAP_BYTES

            dataset = _facade(server).get_dataset("product-images")

            assert [entry.id for entry in dataset.entries] == [
                f"rec_{i}" for i in range(40)
            ]
            assert [entry.entry["index"] for entry in dataset.entries] == list(range(40))
            assert len(dataset.entries[39].entry["image"]) == MB
            assert (dataset.id, dataset.name, dataset.slug) == (
                "dataset_images",
                "Product images",
                "product-images",
            )
            assert "GET /api/v1/dataset/product-images" not in server.requests
            assert "GET /api/v1/dataset" not in server.requests
            # The second page is smaller: the first one came back above the byte target.
            assert server.record_pages == [
                {"page": 1, "limit": 16},
                {"page": 3, "limit": 8},
                {"page": 4, "limit": 8},
                {"page": 5, "limit": 8},
            ]

        # @scenario "Get dataset keeps the shape of the single response"
        def test_answers_the_metadata_with_every_record_under_data(self):
            server = FakeDatasetServer(row_count=3, row_bytes=lambda _: 10)

            raw = _service(server).get_dataset("product-images")

            assert {key: raw[key] for key in DATASET} == DATASET
            assert raw["data"] == [server.row(i) for i in range(3)]
            assert set(raw) == set(DATASET) | {"data"}

        # @scenario "Get dataset result still converts to a pandas DataFrame"
        def test_converts_to_a_pandas_dataframe(self):
            pytest.importorskip("pandas")
            server = FakeDatasetServer(row_count=300, row_bytes=lambda _: 10)

            frame = _facade(server).get_dataset("product-images").to_pandas()

            assert list(frame["index"]) == list(range(300))

    class TestWhenTheServerRefusesAPageAsTooLarge:
        """when the server refuses a page as too large"""

        # @scenario "Get dataset follows the page size a refusal suggests"
        def test_asks_again_with_the_suggested_page_size(self):
            server = FakeDatasetServer(
                row_count=40, row_bytes=lambda _: MB, page_cap_bytes=5 * MB
            )

            dataset = _facade(server).get_dataset("product-images")

            assert [entry.id for entry in dataset.entries] == [
                f"rec_{i}" for i in range(40)
            ]
            assert server.refused_pages[0] == {"page": 1, "limit": 16}
            assert server.record_pages == [
                {"page": page, "limit": 4} for page in range(1, 11)
            ]
            # Later attempts to grow the page are spaced further and further apart.
            assert [page["limit"] for page in server.refused_pages[1:]] == [8, 8, 8]

        # @scenario "Get dataset asks for fewer rows when the server refuses a page as too large"
        def test_halves_the_page_size_and_reads_on_from_the_same_row(self):
            server = FakeDatasetServer(
                row_count=40,
                row_bytes=lambda _: MB,
                page_cap_bytes=5 * MB,
                suggests_limit=False,
            )

            dataset = _facade(server).get_dataset("product-images")

            assert [entry.id for entry in dataset.entries] == [
                f"rec_{i}" for i in range(40)
            ]
            assert server.refused_pages[:2] == [
                {"page": 1, "limit": 16},
                {"page": 1, "limit": 8},
            ]
            assert server.record_pages == [
                {"page": page, "limit": 4} for page in range(1, 11)
            ]

        # @scenario "Get dataset reads one oversized row alone and returns to larger pages"
        def test_reads_an_oversized_row_alone_then_grows_the_page_again(self):
            server = FakeDatasetServer(
                row_count=600,
                row_bytes=lambda index: 20 * MB if index == 0 else 1024,
                page_cap_bytes=20 * MB,
            )

            dataset = _facade(server).get_dataset("product-images")

            assert [entry.entry["index"] for entry in dataset.entries] == list(range(600))
            assert server.record_pages[0] == {"page": 1, "limit": 1}
            assert max(page["limit"] for page in server.record_pages) == 512

        # @scenario "Get dataset raises the refusal when a single row is too large to read"
        def test_raises_the_refusal_for_a_row_no_page_can_hold(self):
            server = FakeDatasetServer(
                row_count=2,
                row_bytes=lambda _: 2 * MB,
                page_cap_bytes=MB,
                refuses_single_rows=True,
            )

            with pytest.raises(DatasetApiError) as refusal:
                _facade(server).get_dataset("product-images")

            assert refusal.value.status_code == 413
            assert server.refused_pages[-1] == {"page": 1, "limit": 1}

    class TestWhenTheServerSendsNoDatasetWithItsPages:
        """when the server sends no dataset with its pages"""

        # @scenario "Get dataset finds the metadata in the datasets list on a server that sends none with its pages"
        def test_reads_the_metadata_from_the_datasets_list(self):
            server = FakeDatasetServer(
                row_count=40, row_bytes=lambda _: MB, sends_dataset_with_pages=False
            )

            dataset = _facade(server).get_dataset("product-images")

            assert (dataset.id, dataset.name, dataset.slug) == (
                "dataset_images",
                "Product images",
                "product-images",
            )
            assert len(dataset.entries) == 40
            assert server.requests[-1] == "GET /api/v1/dataset"
            assert "GET /api/v1/dataset/product-images" not in server.requests

        # @scenario "Get dataset raises the server's refusal when only the single request can name the dataset"
        def test_raises_the_single_request_refusal_instead_of_a_partial_result(self):
            server = FakeDatasetServer(
                row_count=40,
                row_bytes=lambda _: MB,
                sends_dataset_with_pages=False,
                lists_dataset=False,
            )

            with pytest.raises(DatasetApiError) as refusal:
                _facade(server).get_dataset("product-images")

            assert refusal.value.status_code == 400
            assert "larger than the 27.7 MB one response carries" in str(refusal.value)

    class TestWhenTheServerHasNoRecordsEndpoint:
        """when the server has no records endpoint"""

        # @scenario "Get dataset falls back to the single request on a server without the records endpoint"
        def test_reads_the_dataset_with_the_single_request(self):
            server = FakeDatasetServer(
                row_count=5, row_bytes=lambda _: 10, has_records_endpoint=False
            )

            dataset = _facade(server).get_dataset("product-images")

            assert [entry.id for entry in dataset.entries] == [f"rec_{i}" for i in range(5)]
            assert dataset.slug == "product-images"
            assert server.requests == [
                "GET /api/v1/dataset/product-images/records",
                "GET /api/v1/dataset/product-images",
            ]

        # @scenario "Get dataset raises not found when neither request finds the dataset"
        def test_raises_not_found_for_a_missing_dataset(self):
            server = FakeDatasetServer(row_count=0, row_bytes=lambda _: 0)

            with pytest.raises(DatasetNotFoundError):
                _facade(server).get_dataset("does-not-exist")

    class TestWhenTheDatasetChangesWhileItIsRead:
        """when the dataset changes while it is read"""

        # @scenario "Get dataset stops when rows are removed while it is reading"
        def test_stops_at_the_first_short_page(self):
            server = FakeDatasetServer(
                row_count=600,
                row_bytes=lambda _: 10,
                row_count_after_first_page=300,
            )

            dataset = _facade(server).get_dataset("product-images")

            assert [entry.entry["index"] for entry in dataset.entries] == list(range(300))
            assert server.record_pages[-1] == {"page": 2, "limit": 256}
