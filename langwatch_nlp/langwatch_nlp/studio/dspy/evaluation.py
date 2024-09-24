import asyncio
import time
from typing import Callable, Optional, Any, Tuple, Literal, overload
import httpx
import langwatch
from pydantic import BaseModel
import dspy
from tenacity import retry, stop_after_attempt, wait_fixed
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
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._evaluation = evaluation
        self._cost = cost

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
        self.futures = []

    def evaluate_and_report(
        self,
        example: dspy.Example,
        pred: PredictionWithEvaluationCostAndDuration,
        trace=None,
    ):
        evaluation, evaluation_results = pred.evaluation(example, return_results=True)

        self.futures.append(self.post_results(example, pred, evaluation_results))

        return evaluation

    async def wait_for_completion(self):
        await asyncio.gather(*self.futures)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_fixed(1),
        reraise=True,
    )
    async def post_results(
        self,
        example: dspy.Example,
        pred: PredictionWithEvaluationCostAndDuration,
        evaluation_results: dict[str, EvaluationResultWithMetadata],
    ):
        entry = dict(example)
        del entry["_index"]
        cost = pred.get_cost() if hasattr(pred, "get_cost") else None
        duration = pred.get_duration() if hasattr(pred, "get_duration") else None

        evaluations = []
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

            evaluations.append(evaluation)

        body = {
            "experiment_slug": self.workflow.workflow_id,
            "name": f"{self.workflow.name} - Evaluations",
            "workflow_id": self.workflow.workflow_id,
            "run_id": self.run_id,
            "workflow_version_id": self.workflow_version_id,
            "dataset": [
                {
                    "index": example._index,
                    "entry": entry,
                    "cost": cost,
                    "duration": duration,
                }
            ],
            "evaluations": evaluations,
            "timestamps": {
                "created_at": int(time.time() * 1000),
            },
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{langwatch.endpoint}/api/evaluations/batch/log_results",
                headers={"Authorization": f"Bearer {self.workflow.api_key}"},
                json=body,
            )

        response.raise_for_status()
