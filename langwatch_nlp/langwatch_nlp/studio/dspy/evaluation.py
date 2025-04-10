import asyncio
import threading
import time
from typing import List, Optional, Any, Literal
import httpx
import langwatch
from pydantic import BaseModel, Field
import dspy
from tenacity import retry, stop_after_attempt, wait_exponential
from langwatch_nlp.studio.runtimes.base_runtime import ServerEventQueue
from langwatch_nlp.studio.dspy.predict_with_metadata import (
    PredictionWithMetadata,
)
from langevals_core.base_evaluator import Money

from langwatch_nlp.studio.types.dsl import EvaluationExecutionState, Workflow
from langwatch_nlp.studio.types.events import (
    EvaluationStateChange,
    EvaluationStateChangePayload,
)
from langwatch_nlp.studio.utils import get_node_by_id


class Evaluator(dspy.Module):
    def __init__(self):
        super().__init__()

    def forward(self):
        try:
            langwatch.get_current_span().update(type="evaluation")
        except Exception:
            pass

    @classmethod
    def trace_evaluation(cls, func):
        def wrapper(self, *args, **kwargs):
            try:
                result: EvaluationResultWithMetadata = func(self, *args, **kwargs)
            except Exception as error:
                try:
                    langwatch.get_current_span().add_evaluation(
                        name=self.__class__.__name__,
                        status="error",
                        error=error,
                    )
                except Exception:
                    pass
                raise error

            try:
                langwatch.get_current_span().add_evaluation(
                    **result.model_dump(exclude_unset=True, exclude_none=True),
                    name=self.__class__.__name__,
                )
            except Exception:
                pass

            return result

        return wrapper


class EvaluationResultWithMetadata(BaseModel):
    status: Literal["processed", "error", "skipped"]
    score: Optional[float] = None
    passed: Optional[bool] = None
    label: Optional[str] = None
    details: Optional[str] = Field(
        default=None, description="Short human-readable description of the result"
    )
    inputs: dict[str, Any]
    cost: Optional[Money] = None
    duration: int


class PredictionWithEvaluationAndMetadata(PredictionWithMetadata):
    def __init__(
        self,
        cost: float,
        duration: int,
        error: Optional[Exception] = None,
        evaluations: dict[str, EvaluationResultWithMetadata] = {},
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._cost = cost
        self._duration = duration
        self._error = error
        self.evaluations = evaluations

    def total_score(self, weighting: Literal["mean"] = "mean") -> float:
        def get_score(result: EvaluationResultWithMetadata) -> float:
            return (
                result.score
                if result.score is not None
                else float(result.passed) if result.passed is not None else 0
            )

        if weighting == "mean":
            evaluation_scores = [
                get_score(evaluation)
                for evaluation in self.evaluations.values()
                if evaluation.status == "processed"
            ]
            return sum(evaluation_scores) / max(len(evaluation_scores), 1)
        else:
            raise ValueError(f"Unsupported evaluation weighting: {weighting}")


class EvaluationReporting:
    def __init__(
        self,
        workflow: Workflow,
        workflow_version_id: str,
        run_id: str,
        total: int,
        queue: "ServerEventQueue",
    ):
        self.workflow = workflow
        self.workflow_version_id = workflow_version_id
        self.run_id = run_id
        self.created_at = int(time.time() * 1000)
        self.total = total
        self.progress = 0
        self.queue = queue

        self.lock = threading.Lock()
        self.batch = {"dataset": [], "evaluations": []}
        self.last_sent = 0
        self.debounce_interval = 1  # 1 second
        self.threads: List[threading.Thread] = []

    def evaluate_and_report(
        self,
        example: dspy.Example,
        pred: PredictionWithEvaluationAndMetadata,
        trace=None,
    ):
        evaluation, evaluation_results = pred.evaluate(example, return_results=True)

        if self.progress == 0:
            self.last_sent = 0

        with self.lock:
            self.add_to_batch(example, pred, evaluation_results)
            self.progress += 1

        self.queue.put_nowait(
            EvaluationStateChange(
                payload=EvaluationStateChangePayload(
                    evaluation_state=EvaluationExecutionState(
                        run_id=self.run_id, progress=self.progress, total=self.total
                    )
                )
            )
        )

        # Check if it's time to send the batch
        if time.time() - self.last_sent >= self.debounce_interval:
            self.send_batch()

        return evaluation

    def add_to_batch(
        self,
        example: dspy.Example,
        pred: PredictionWithEvaluationAndMetadata,
        evaluation_results: dict[str, EvaluationResultWithMetadata],
    ):
        entry = dict(example.inputs())
        cost = pred.cost if hasattr(pred, "cost") else None
        duration = pred.duration if hasattr(pred, "duration") else None
        error = pred.error if hasattr(pred, "error") else None

        node_results = {
            **pred.__dict__.get("_store", {}),
            **{k: v for k, v in pred.__dict__.items() if not k.startswith("_")},
        }

        predicted = {
            "index": example._index,
            "entry": entry,
            "cost": cost,
            "duration": duration,
        }
        if error:
            predicted["error"] = str(error)
        if "end" in node_results:
            predicted["predicted"] = node_results["end"]

        self.batch["dataset"].append(predicted)

        for node_id, result in evaluation_results.items():
            node = get_node_by_id(self.workflow, node_id)
            if not node:
                raise ValueError(f"Node with id {node_id} not found")

            evaluation = {
                "evaluator": node_id,
                "name": node.data.name,
                "status": result.status,
                "index": example._index,
                "duration": result.duration,
                "inputs": result.inputs,
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
            body = {
                "experiment_id": self.workflow.experiment_id,
                "experiment_slug": (
                    None if self.workflow.experiment_id else self.workflow.workflow_id
                ),
                "name": (
                    None
                    if self.workflow.experiment_id
                    else f"{self.workflow.name} - Evaluations"
                ),
                "workflow_id": self.workflow.workflow_id,
                "run_id": self.run_id,
                "workflow_version_id": self.workflow_version_id,
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
                target=EvaluationReporting.post_results,
                args=(self.workflow.api_key, body),
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
            f"{langwatch.endpoint}/api/evaluations/batch/log_results",
            headers={"Authorization": f"Bearer {api_key}"},
            json=body,
            timeout=60,
        )
        response.raise_for_status()

    async def wait_for_completion(self):
        # Send any remaining batch
        self.send_batch(finished=True)

        for thread in self.threads:
            await asyncio.sleep(0)
            thread.join()
