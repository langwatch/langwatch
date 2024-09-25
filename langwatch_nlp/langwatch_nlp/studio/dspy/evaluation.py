import asyncio
import threading
import time
from typing import Callable, List, Optional, Any, Tuple, Literal, overload
import httpx
import langwatch
from pydantic import BaseModel
import dspy
from tenacity import retry, stop_after_attempt, wait_exponential
from langwatch_nlp.studio.dspy.predict_with_cost_and_duration import (
    PredictionWithCostAndDuration,
)
from langevals_core.base_evaluator import SingleEvaluationResult

from langwatch_nlp.studio.types.dsl import Workflow
from langwatch_nlp.studio.utils import get_node_by_id


class EvaluationResultWithMetadata(BaseModel):
    result: SingleEvaluationResult
    inputs: dict[str, Any]
    duration: int


class PredictionWithEvaluationCostAndDuration(PredictionWithCostAndDuration):
    def __init__(
        self,
        evaluation: Callable[
            [dspy.Example, dspy.Prediction, Optional[Any], bool],
            float | tuple[float, dict],
        ],
        cost: float,
        duration: int,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._evaluation = evaluation
        self._cost = cost
        self._duration = duration

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
    def __init__(self, workflow: Workflow, workflow_version_id: str, run_id: str):
        self.workflow = workflow
        self.workflow_version_id = workflow_version_id
        self.run_id = run_id
        self.created_at = int(time.time() * 1000)

        self.lock = threading.Lock()
        self.batch = {"dataset": [], "evaluations": []}
        self.last_sent = time.time()
        self.debounce_interval = 1  # 1 second
        self.threads: List[threading.Thread] = []

    def evaluate_and_report(
        self,
        example: dspy.Example,
        pred: PredictionWithEvaluationCostAndDuration,
        trace=None,
    ):
        evaluation, evaluation_results = pred.evaluation(example, return_results=True)

        with self.lock:
            self.add_to_batch(example, pred, evaluation_results)

        # Check if it's time to send the batch
        if time.time() - self.last_sent >= self.debounce_interval:
            self.send_batch()

        return evaluation

    def add_to_batch(
        self,
        example: dspy.Example,
        pred: PredictionWithEvaluationCostAndDuration,
        evaluation_results: dict[str, EvaluationResultWithMetadata],
    ):
        entry = dict(example.inputs())
        cost = pred.get_cost() if hasattr(pred, "get_cost") else None
        duration = pred.get_duration() if hasattr(pred, "get_duration") else None

        self.batch["dataset"].append(
            {
                "index": example._index,
                "entry": entry,
                "cost": cost,
                "duration": duration,
            }
        )

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
                evaluation["score"] = result.score
                evaluation["passed"] = result.passed
                evaluation["label"] = result.label
                evaluation["details"] = result.details
                evaluation["cost"] = result.cost

            self.batch["evaluations"].append(evaluation)

    def send_batch(self, finished: bool = False):
        with self.lock:
            if (
                not finished
                and not self.batch["dataset"]
                and not self.batch["evaluations"]
            ):
                return

            body = {
                "experiment_slug": self.workflow.workflow_id,
                "name": f"{self.workflow.name} - Evaluations",
                "workflow_id": self.workflow.workflow_id,
                "run_id": self.run_id,
                "workflow_version_id": self.workflow_version_id,
                "dataset": self.batch["dataset"],
                "evaluations": self.batch["evaluations"],
                "timestamps": {
                    "created_at": self.created_at,
                },
            }

            if finished:
                body["timestamps"]["finished_at"] = int(time.time() * 1000)

            # Start a new thread to send the batch
            thread = threading.Thread(target=self.post_results, args=(body,))
            thread.start()
            self.threads.append(thread)

            # Clear the batch and update the last sent time
            self.batch = {"dataset": [], "evaluations": []}
            self.last_sent = time.time()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    def post_results(self, body):
        response = httpx.post(
            f"{langwatch.endpoint}/api/evaluations/batch/log_results",
            headers={"Authorization": f"Bearer {self.workflow.api_key}"},
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
