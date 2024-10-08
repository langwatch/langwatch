import asyncio
from multiprocessing import Queue
import threading
import time
from typing import Callable, List, Optional, Any, Tuple, Literal, overload
import httpx
import langwatch
from pydantic import BaseModel
import dspy
from tenacity import retry, stop_after_attempt, wait_exponential
from langwatch_nlp.studio.dspy.predict_with_metadata import (
    PredictionWithMetadata,
)
from langevals_core.base_evaluator import SingleEvaluationResult

from langwatch_nlp.studio.types.dsl import EvaluationExecutionState, Workflow
from langwatch_nlp.studio.types.events import (
    EvaluationStateChange,
    EvaluationStateChangePayload,
    StudioServerEvent,
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


class EvaluationResultWithMetadata(BaseModel):
    result: SingleEvaluationResult
    inputs: dict[str, Any]
    duration: int


class PredictionWithEvaluationAndMetadata(PredictionWithMetadata):
    def __init__(
        self,
        evaluation: Callable[
            [dspy.Example, PredictionWithMetadata, Optional[Any], bool],
            float | tuple[float, dict],
        ],
        cost: float,
        duration: int,
        error: Optional[Exception] = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._evaluation = evaluation
        self._cost = cost
        self._duration = duration
        self._error = error

    @overload
    def evaluation(
        self,
        example: dspy.Example,
        trace: Optional[Any] = None,
        return_results: Literal[False] = False,
    ) -> float: ...

    @overload
    def evaluation(
        self,
        example: dspy.Example,
        trace: Optional[Any] = None,
        return_results: Literal[True] = True,
    ) -> Tuple[float, dict[str, EvaluationResultWithMetadata]]: ...

    def evaluation(
        self,
        example,
        trace=None,
        return_results=False,
    ) -> float | tuple[float, dict[str, EvaluationResultWithMetadata]]:
        return self._evaluation(example, self, trace, return_results)


class EvaluationReporting:
    def __init__(
        self,
        workflow: Workflow,
        workflow_version_id: str,
        run_id: str,
        total: int,
        queue: "Queue[StudioServerEvent]",
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
        evaluation, evaluation_results = pred.evaluation(example, return_results=True)

        if self.progress == 0:
            # Send initial empty batch to create the experiment in LangWatch
            self.send_batch()
            self.last_sent = 0

        with self.lock:
            self.add_to_batch(example, pred, evaluation_results)
            self.progress += 1

        self.queue.put(
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
        cost = pred.get_cost() if hasattr(pred, "get_cost") else None
        duration = pred.get_duration() if hasattr(pred, "get_duration") else None
        error = pred.get_error() if hasattr(pred, "get_error") else None

        predicted = {
            "index": example._index,
            "entry": entry,
            "cost": cost,
            "duration": duration,
        }
        if error:
            predicted["error"] = str(error)

        self.batch["dataset"].append(predicted)

        for node_id, result_with_metadata in evaluation_results.items():
            node = get_node_by_id(self.workflow, node_id)
            if not node:
                raise ValueError(f"Node with id {node_id} not found")

            result = result_with_metadata.result

            evaluation = {
                "evaluator": node_id,
                "name": node.data.name,
                "status": result.status,
                "index": example._index,
                "duration": result_with_metadata.duration,
                "inputs": result_with_metadata.inputs,
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
                "experiment_slug": self.workflow.workflow_id,
                "name": f"{self.workflow.name} - Evaluations",
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
            timeout=10,
        )
        response.raise_for_status()

    async def wait_for_completion(self):
        # Send any remaining batch
        self.send_batch(finished=True)

        for thread in self.threads:
            await asyncio.sleep(0)
            thread.join()
