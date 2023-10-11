from typing import List, Optional, TypeVar
import nanoid
import requests
from concurrent.futures import ThreadPoolExecutor
from retry import retry

import langwatch
from langwatch.types import SpanTrace

T = TypeVar("T")


class BaseContextTracer:
    def __init__(self, trace_id: Optional[str] = None):
        self.spans: List[SpanTrace] = []
        self.trace_id = trace_id or f"trace_{nanoid.generate()}"

    def __enter__(self):
        pass

    def __exit__(self, _type, _value, _traceback):
        send_spans(self.spans)


executor = ThreadPoolExecutor(max_workers=10)


@retry(tries=5, delay=0.5, backoff=3)
def _send_spans(spans: List[SpanTrace]):
    response = requests.post(langwatch.endpoint, json={"spans": spans})
    response.raise_for_status()


def send_spans(spans: List[SpanTrace]):
    if len(spans) == 0:
        return
    executor.submit(_send_spans, spans)
