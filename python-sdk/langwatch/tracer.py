from typing import List
import requests
from concurrent.futures import ThreadPoolExecutor
from retry import retry

import langwatch
from langwatch.types import StepTrace

executor = ThreadPoolExecutor(max_workers=10)


@retry(tries=5, delay=0.5, backoff=3)
def _send_steps(steps: List[StepTrace]):
    response = requests.post(langwatch.endpoint, json={"steps": steps})
    response.raise_for_status()


def send_steps(steps: List[StepTrace]):
    executor.submit(_send_steps, steps)
