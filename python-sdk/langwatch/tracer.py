from typing import List, Optional, TypeVar
import nanoid
import requests
from concurrent.futures import ThreadPoolExecutor
from retry import retry

import langwatch
from langwatch.types import StepTrace

T = TypeVar("T")


class BaseTracer:
    def __init__(self, trace_id: Optional[str] = None):
        self.steps: List[StepTrace] = []
        self.trace_id = trace_id or f"trace_{nanoid.generate()}"

    def __enter__(self):
        pass

    def __exit__(self, _type, _value, _traceback):
        if len(self.steps) > 0:
            send_steps(self.steps)


executor = ThreadPoolExecutor(max_workers=10)


@retry(tries=5, delay=0.5, backoff=3)
def _send_steps(steps: List[StepTrace]):
    response = requests.post(langwatch.endpoint, json={"steps": steps})
    response.raise_for_status()


def send_steps(steps: List[StepTrace]):
    executor.submit(_send_steps, steps)
