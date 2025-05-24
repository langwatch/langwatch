from typing import Any, Dict, List
from opentelemetry import trace
from langwatch.generated.langwatch_rest_api_client.api.default import (
    get_api_dataset_by_slug_or_id,
)

from langwatch.generated.langwatch_rest_api_client.models import (
    GetApiDatasetBySlugOrIdResponse200,
    GetApiDatasetBySlugOrIdResponse200DataItem,
    GetApiDatasetBySlugOrIdResponse404,
    GetApiDatasetBySlugOrIdResponse401,
    GetApiDatasetBySlugOrIdResponse500,
    GetApiDatasetBySlugOrIdResponse400,
)
from langwatch.state import get_instance
import pandas as pd

from langwatch.utils.initialization import ensure_setup

_tracer = trace.get_tracer(__name__)


class DatasetEntry:
    def __init__(self, item: GetApiDatasetBySlugOrIdResponse200DataItem):
        self.id: str = item.id
        self.entry: Dict[str, Any] = item.entry.to_dict()


class Dataset:
    def __init__(self, dataset: GetApiDatasetBySlugOrIdResponse200):
        self.entries: List[DatasetEntry] = []

        for item in dataset.data:
            self.entries.append(DatasetEntry(item))

    def to_pandas(self) -> pd.DataFrame:
        return pd.DataFrame([entry.entry for entry in self.entries])


def get_dataset(slug_or_id: str) -> Dataset:
    ensure_setup()

    with _tracer.start_as_current_span("get_dataset") as span:
        span.set_attribute("inputs.slug_or_id", slug_or_id)

        try:
            client = get_instance()
            ds = get_api_dataset_by_slug_or_id.sync(
                slug_or_id=slug_or_id,
                client=client.rest_api_client,
            )

            if (
                isinstance(ds, GetApiDatasetBySlugOrIdResponse404)
                or isinstance(ds, GetApiDatasetBySlugOrIdResponse401)
                or isinstance(ds, GetApiDatasetBySlugOrIdResponse500)
                or isinstance(ds, GetApiDatasetBySlugOrIdResponse400)
            ):
                raise Exception(ds.message)

            if isinstance(ds, GetApiDatasetBySlugOrIdResponse200):
                dataset = Dataset(ds)

                span.set_attribute("outputs.dataset_length", len(dataset.entries))

                return dataset

            raise Exception(f"Unknown response type: {type(ds)}")

        except Exception as ex:
            span.record_exception(ex)
            raise
