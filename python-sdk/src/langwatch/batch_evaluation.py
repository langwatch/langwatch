import asyncio
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
import threading
import time
from typing import (
    Any,
    Callable,
    Coroutine,
    Dict,
    List,
    Literal,
    Optional,
    Tuple,
    Union,
)
from tenacity import retry, stop_after_attempt, wait_exponential
from typing_extensions import TypedDict
from pydantic import BaseModel, Field
from coolname import generate_slug
import urllib.parse
import langwatch
import httpx
from tqdm import tqdm
import pandas as pd

from langwatch.types import Money


class EvaluationResult(BaseModel):
    status: Literal["processed"] = "processed"
    score: Optional[float] = Field(default=None, description="No description provided")
    passed: Optional[bool] = None
    details: Optional[str] = Field(
        default=None, description="Short human-readable description of the result"
    )
    label: Optional[str] = None
    cost: Optional[Money] = None
    duration: Optional[int] = None


class EvaluationResultSkipped(BaseModel):
    status: Literal["skipped"] = "skipped"
    details: Optional[str] = None
    duration: Optional[int] = None


class EvaluationResultError(BaseModel):
    status: Literal["error"] = "error"
    error_type: str = Field(description="The type of the exception")
    details: str = Field(description="Error message")
    traceback: List[str] = Field(description="Traceback information for debugging")
    duration: Optional[int] = None


SingleEvaluationResult = Union[
    EvaluationResult, EvaluationResultSkipped, EvaluationResultError
]


class ConversationMessage(TypedDict):
    input: str
    output: str


class DatasetEntry(BaseModel):
    class Config:
        extra = "allow"

    def __getitem__(self, item: str) -> Any:
        return getattr(self, item)

    @property
    def __dict__(self):
        return {k: getattr(self, k) for k in self.__pydantic_fields_set__}

    @__dict__.setter
    def __dict__(self, value: dict):
        for key, val in value.items():
            setattr(self, key, val)


class DatasetRecord(BaseModel):
    id: str
    index: Optional[int] = None
    entry: DatasetEntry


class BatchEvaluationResultRecord(BaseModel):
    entry: DatasetEntry
    results: list[Tuple[str, SingleEvaluationResult]]
    duration: int
    error: Optional[str] = None


class BatchEvaluationRun(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    list: list[BatchEvaluationResultRecord]
    df: pd.DataFrame


class BatchEvaluation:
    def __init__(
        self,
        dataset: str,
        evaluations: list[str],
        callback: Callable[[DatasetEntry], Union[str, dict[str, Any]]],
        experiment: Optional[str] = None,
        run_id: Optional[str] = None,
        max_workers=4,
    ):
        self.dataset = dataset
        self.evaluations = evaluations
        self.callback = callback
        self.max_workers = max_workers
        self.experiment = experiment or generate_slug(3)
        self.experiment_slug = self.experiment
        self.run_id = run_id or generate_slug(3)
        self.total = 0
        self.progress = 0
        self.created_at = int(time.time() * 1000)

        self.lock = threading.Lock()
        self.batch = {"dataset": [], "evaluations": []}
        self.last_sent = 0
        self.debounce_interval = 1  # 1 second
        self.threads: List[threading.Thread] = []

    def run(self):
        if langwatch.get_api_key() is None:
            print("API key was not detected, calling langwatch.login()...")
            langwatch.login()

        dataset = get_dataset(self.dataset)

        print("Starting batch evaluation...")
        with httpx.Client(timeout=60) as client:
            response = client.post(
                f"{langwatch.get_endpoint()}/api/experiment/init",
                headers={"X-Auth-Token": langwatch.get_api_key() or ""},
                json={
                    "experiment_name": self.experiment,
                    "experiment_slug": self.experiment,
                    "experiment_type": "BATCH_EVALUATION_V2",
                },
            )
        if response.status_code == 401:
            langwatch.get_api_key()
            raise ValueError(
                "API key is not valid, please try to login again with langwatch.login()"
            )
        response.raise_for_status()
        experiment_path = response.json()["path"]
        self.experiment_slug = response.json()["slug"]

        url_encoded_run_id = urllib.parse.quote(self.run_id)
        print(
            f"Follow the results at: {langwatch.get_endpoint()}{experiment_path}?runId={url_encoded_run_id}"
        )

        if dataset is None:
            raise Exception(f"Dataset {self.dataset} not found.")

        if len(dataset) == 0:
            raise Exception(f"Dataset {self.dataset} is empty.")

        results: list[BatchEvaluationResultRecord] = []

        self.total = len(dataset)

        try:
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures: List[Future] = [
                    executor.submit(self.run_record, record) for record in dataset
                ]
                for future in tqdm(as_completed(futures), total=self.total):
                    results.append(future.result())

                executor.submit(self.wait_for_completion).result()

            print(f"Batch evaluation done!")

            return BatchEvaluationRun(
                list=results,
                df=self._results_to_pandas(results),
            )

        except Exception as e:
            BatchEvaluation.post_results(
                langwatch.get_api_key() or "",
                {
                    "experiment_slug": self.experiment_slug,
                    "run_id": self.run_id,
                    "timestamps": {
                        "finished_at": int(time.time() * 1000),
                        "stopped_at": int(time.time() * 1000),
                    },
                },
            )
            raise e

    def _results_to_pandas(self, results: list[BatchEvaluationResultRecord]):
        results_df = []
        for result in results:
            result_dict: dict[str, Any] = result.entry.model_dump()
            for evaluation_name, evaluation_result in result.results:
                if evaluation_result.status == "processed":
                    result_dict[evaluation_name] = (
                        evaluation_result.score
                        if evaluation_result.passed is None
                        else evaluation_result.passed
                    )
                else:
                    result_dict[evaluation_name] = evaluation_result.status
            results_df.append(result_dict)

        return pd.DataFrame(results_df)

    def run_record(self, record: DatasetRecord):
        entry = record.entry

        error: Optional[Exception] = None
        start_time = time.time()
        try:
            callbackResponse = self.callback(entry)
        except Exception as e:
            error = e
            callbackResponse = None
        duration = int((time.time() - start_time) * 1000)

        entry_with_output: DatasetEntry
        if (
            isinstance(callbackResponse, str)
            or isinstance(callbackResponse, int)
            or isinstance(callbackResponse, float)
        ):
            entry_with_output = DatasetEntry(
                **{**entry.model_dump(), "output": callbackResponse}
            )
        else:
            entry_with_output = DatasetEntry(
                **{**entry.model_dump(), **(callbackResponse or {})}
            )

        coroutines: list[Coroutine[Tuple[str, SingleEvaluationResult], Any, Any]] = []
        for evaluation in self.evaluations:
            coroutines.append(run_evaluation(entry_with_output, evaluation, error))

        async def gather_results(futures):
            evaluation_results = await asyncio.gather(*futures)

            results = BatchEvaluationResultRecord(
                entry=entry_with_output,
                results=evaluation_results,
                duration=duration,
                error=str(error) if error else None,
            )

            with self.lock:
                self.add_to_batch(record, callbackResponse, results)
                self.progress += 1

            return results

        # Check if it's time to send the batch
        if time.time() - self.last_sent >= self.debounce_interval:
            self.send_batch()

        return asyncio.run(gather_results(coroutines))

    def add_to_batch(
        self,
        record: DatasetRecord,
        callbackResponse: Optional[Union[str, int, float, Dict[str, Any]]],
        results: BatchEvaluationResultRecord,
    ):
        predicted = {
            "index": record.index,
            "entry": record.entry.model_dump(),
            "duration": results.duration,
        }
        if results.error:
            predicted["error"] = results.error

        if (
            isinstance(callbackResponse, str)
            or isinstance(callbackResponse, int)
            or isinstance(callbackResponse, float)
        ):
            predicted["predicted"] = {"output": callbackResponse}
        elif isinstance(callbackResponse, dict):
            predicted["predicted"] = callbackResponse

        self.batch["dataset"].append(predicted)

        for evaluator, result in results.results:
            evaluation = {
                "evaluator": evaluator,
                "name": evaluator,
                "status": result.status,
                "index": record.index,
                "duration": result.duration,
            }

            if result.status == "processed":
                if result.score is not None:
                    evaluation["score"] = result.score
                if result.passed is not None:
                    evaluation["passed"] = result.passed
                if result.label is not None:
                    evaluation["label"] = result.label
                if result.details is not None:
                    evaluation["details"] = result.details
                if result.cost is not None:
                    evaluation["cost"] = result.cost.amount
            elif result.status == "error" or result.status == "skipped":
                evaluation["details"] = result.details

            self.batch["evaluations"].append(evaluation)

    def send_batch(self, finished: bool = False):
        with self.lock:
            if len(self.batch["dataset"]) == 0 and len(self.batch["evaluations"]) == 0:
                return

            body = {
                "experiment_slug": self.experiment_slug,
                "name": f"{self.experiment}",
                "run_id": self.run_id,
                "dataset": self.batch["dataset"],
                "evaluations": self.batch["evaluations"],
                "progress": self.progress,
                "total": self.total,
                "timestamps": {
                    "created_at": self.created_at,
                },
            }

            if finished:
                body["timestamps"]["finished_at"] = int(time.time() * 1000)

            # Start a new thread to send the batch
            thread = threading.Thread(
                target=BatchEvaluation.post_results,
                args=(langwatch.get_api_key(), body),
            )
            thread.start()
            self.threads.append(thread)

            # Clear the batch and update the last sent time
            self.batch = {"dataset": [], "evaluations": []}
            self.last_sent = time.time()

    @classmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    def post_results(cls, api_key: str, body: dict):
        response = httpx.post(
            f"{langwatch.get_endpoint()}/api/evaluations/batch/log_results",
            headers={"Authorization": f"Bearer {api_key}"},
            json=body,
            timeout=60,
        )
        response.raise_for_status()

    def wait_for_completion(self):
        async def wait_for_completion(self):
            # Send any remaining batch
            self.send_batch(finished=True)

            for thread in self.threads:
                await asyncio.sleep(0)
                thread.join()

        asyncio.run(wait_for_completion(self))


async def run_evaluation(
    data: DatasetEntry,
    evaluation: str,
    error: Optional[Exception] = None,
) -> Tuple[str, SingleEvaluationResult]:
    if error:
        return evaluation, EvaluationResultSkipped(
            status="skipped",
            details="Cannot evaluate entry with errors",
            duration=0,
        )

    try:
        json_data = {
            "data": data.model_dump(),
        }

        request_params = {
            "url": langwatch.get_endpoint() + f"/api/evaluations/{evaluation}/evaluate",
            "headers": {"X-Auth-Token": langwatch.get_api_key()},
            "json": json_data,
        }

        start_time = time.time()

        async with httpx.AsyncClient(timeout=900) as client:
            response = await client.post(**request_params)
            response.raise_for_status()

        result = response.json()

        duration = int((time.time() - start_time) * 1000)

        evaluation_result: SingleEvaluationResult
        if result["status"] == "processed":
            evaluation_result = EvaluationResult.model_validate(result)
        elif result["status"] == "skipped":
            evaluation_result = EvaluationResultSkipped.model_validate(result)
        else:
            evaluation_result = EvaluationResultError.model_validate(
                {"traceback": [], **(result or {})}
            )

        evaluation_result.duration = duration

        return evaluation, evaluation_result

    except httpx.HTTPStatusError as e:
        if e.response.status_code // 100 == 4:
            raise Exception(f"HTTP error: {e.response.text}")
        else:
            return evaluation, EvaluationResultError(
                error_type="HTTPStatusError",
                details=f"HTTP error {e.response.status_code}: {e.response.text}",
                traceback=[],
            )

    except Exception as e:
        return evaluation, EvaluationResultError(
            error_type="Exception",
            details=str(e),
            traceback=[],
        )


def get_dataset(
    slug: str,
) -> list[DatasetRecord]:
    request_params = {
        "url": langwatch.get_endpoint() + f"/api/dataset/{slug}",
        "headers": {"X-Auth-Token": str(langwatch.get_api_key())},
    }

    with httpx.Client(timeout=300) as client:
        response = client.get(**request_params)
        response.raise_for_status()

    result = response.json()

    if "status" in result and result["status"] == "error":
        # If the response contains a status key and its value is "error"
        error_message = result.get("message", "Unknown error")
        # Get the error message if available, otherwise set it to "Unknown error"
        raise Exception(f"Error: {error_message}")
    else:
        # If the response does not contain a status key or its value is not "error"
        res = result.get("data", None)
        # parse to pydantic
        records = []
        for index, record in enumerate(res):
            if "index" not in record:
                record["index"] = index
            if "id" in record["entry"] and record["entry"]["id"] == record["id"]:
                del record["entry"]["id"]
            if "selected" in record["entry"]:
                del record["entry"]["selected"]
            records.append(DatasetRecord.model_validate(record))
        return records
