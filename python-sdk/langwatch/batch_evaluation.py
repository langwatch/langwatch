import asyncio
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from typing import (
    Any,
    Callable,
    Coroutine,
    List,
    Literal,
    Optional,
    Tuple,
    Union,
)
from typing_extensions import TypedDict
from pydantic import BaseModel, Field
from coolname import generate_slug
import langwatch
import httpx
from tqdm import tqdm
import pandas as pd

from langwatch.types import RAGChunk


class Money(BaseModel):
    currency: str
    amount: float


class EvaluationResult(BaseModel):
    status: Literal["processed"] = "processed"
    score: float = Field(description="No description provided")
    passed: Optional[bool] = None
    details: Optional[str] = Field(
        default=None, description="Short human-readable description of the result"
    )
    cost: Optional[Money] = None


class EvaluationResultSkipped(BaseModel):
    status: Literal["skipped"] = "skipped"
    details: Optional[str] = None


class EvaluationResultError(BaseModel):
    status: Literal["error"] = "error"
    error_type: str = Field(description="The type of the exception")
    message: str = Field(description="Error message")
    traceback: List[str] = Field(description="Traceback information for debugging")


SingleEvaluationResult = Union[
    EvaluationResult, EvaluationResultSkipped, EvaluationResultError
]


class ConversationMessage(TypedDict):
    input: str
    output: str


class DatasetEntry(BaseModel):
    id: Optional[str] = None
    input: Optional[str] = None
    contexts: Optional[Union[list[RAGChunk], list[str]]] = None
    expected_output: Optional[str] = None
    conversation: Optional[list[ConversationMessage]] = None


class DatasetEntryWithOutput(DatasetEntry):
    output: Optional[str] = None


class DatasetRecord(BaseModel):
    id: str
    entry: DatasetEntry


class BatchEvaluationResultRecord(BaseModel):
    entry: DatasetEntryWithOutput
    results: list[Tuple[str, SingleEvaluationResult]]


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
        generations="one-shot",
        max_workers=4,
    ):
        self.dataset = dataset
        self.evaluations = evaluations
        self.callback = callback
        self.generations = generations
        self.max_workers = max_workers

    def run(self):
        print("Starting batch evaluation...")
        if langwatch.api_key is None:
            print("API key was not detected, calling langwatch.login()...")
            langwatch.login()

        experiment_slug = generate_slug(3)
        response = httpx.post(
            f"{langwatch.endpoint}/api/experiment/init",
            headers={"X-Auth-Token": langwatch.api_key or ""},
            json={
                "experiment_slug": experiment_slug,
                "experiment_type": "BATCH_EVALUATION",
            },
        )
        if response.status_code == 401:
            langwatch.api_key = None
            raise ValueError(
                "API key is not valid, please try to login again with langwatch.login()"
            )
        response.raise_for_status()
        experiment_path = response.json()["path"]

        dataset = get_dataset(self.dataset)

        if dataset is None:
            raise Exception(f"Dataset {self.dataset} not found.")

        if len(dataset) == 0:
            raise Exception(f"Dataset {self.dataset} is empty.")

        results: list[BatchEvaluationResultRecord] = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures: List[Future] = [
                executor.submit(self.run_record, record, experiment_slug)
                for record in dataset
            ]
            for future in tqdm(as_completed(futures), total=len(futures)):
                results.append(future.result())

        print(
            f"Batch evaluation done! You can see the results at: {langwatch.endpoint}{experiment_path}"
        )

        return BatchEvaluationRun(
            list=results,
            df=self._results_to_pandas(results),
        )

    def _results_to_pandas(self, results: list[BatchEvaluationResultRecord]):
        results_df = []
        for result in results:
            result_dict: dict[str, Any] = {
                "input": result.entry.input,
                "output": result.entry.output,
            }
            if result.entry.expected_output is not None:
                result_dict["expected_output"] = result.entry.expected_output
            if result.entry.contexts is not None:
                result_dict["contexts"] = result.entry.contexts
            if result.entry.conversation is not None:
                result_dict["conversation"] = result.entry.conversation
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

    def run_record(self, record: DatasetRecord, experiment_slug: str):
        entry = record.entry

        callbackResponse = self.callback(entry)
        entry_with_output = DatasetEntryWithOutput(
            id=record.id,
            input=entry.input,
            expected_output=(
                callbackResponse["expected_output"]
                if not isinstance(callbackResponse, str)
                and "expected_output" in callbackResponse
                else entry.expected_output
            ),
            output=(
                callbackResponse
                if isinstance(callbackResponse, str)
                else callbackResponse["output"]
            ),
            contexts=(
                callbackResponse["contexts"]
                if not isinstance(callbackResponse, str)
                and "contexts" in callbackResponse
                else entry.contexts
            ),
            conversation=(
                callbackResponse["conversation"]
                if not isinstance(callbackResponse, str)
                and "conversation" in callbackResponse
                else entry.conversation
            ),
        )

        coroutines: list[Coroutine[Tuple[str, SingleEvaluationResult], Any, Any]] = []
        for evaluation in self.evaluations:
            coroutines.append(
                run_evaluation(
                    entry_with_output, evaluation, experiment_slug, self.dataset
                )
            )

        async def gather_results(futures):
            return await asyncio.gather(*futures)

        evaluation_results: list[Tuple[str, SingleEvaluationResult]] = asyncio.run(
            gather_results(coroutines)
        )

        return BatchEvaluationResultRecord(
            entry=entry_with_output, results=evaluation_results
        )


async def run_evaluation(
    data: DatasetEntryWithOutput,
    evaluation: str,
    experiment_slug: str,
    dataset_slug: str,
) -> Tuple[str, SingleEvaluationResult]:
    try:
        json_data = {
            "data": data.model_dump(exclude_unset=True),
            "evaluation": evaluation,
            "experimentSlug": experiment_slug,
            "datasetSlug": dataset_slug,
        }

        request_params = {
            "url": langwatch.endpoint + f"/api/dataset/evaluate",
            "headers": {"X-Auth-Token": langwatch.api_key},
            "json": json_data,
        }

        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(**request_params)
            response.raise_for_status()

        result = response.json()
        if result["status"] == "processed":
            return evaluation, EvaluationResult.model_validate(result)
        elif result["status"] == "skipped":
            return evaluation, EvaluationResultSkipped.model_validate(result)
        else:
            return evaluation, EvaluationResultError.model_validate(result)

    except httpx.HTTPStatusError as e:
        if e.response.status_code // 100 == 4:
            raise Exception(f"HTTP error: {e.response.text}")
        else:
            return evaluation, EvaluationResultError(
                error_type="HTTPStatusError",
                message=f"HTTP error {e.response.status_code}: {e.response.text}",
                traceback=[],
            )

    except Exception as e:
        return evaluation, EvaluationResultError(
            error_type="Exception",
            message=str(e),
            traceback=[],
        )


def get_dataset(
    slug: str,
) -> list[DatasetRecord]:
    request_params = {
        "url": langwatch.endpoint + f"/api/dataset/{slug}",
        "headers": {"X-Auth-Token": str(langwatch.api_key)},
    }
    with httpx.Client(timeout=30) as client:
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
        return [DatasetRecord.model_validate(record) for record in res]
