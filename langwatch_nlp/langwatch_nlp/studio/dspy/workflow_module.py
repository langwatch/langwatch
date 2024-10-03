import time
from typing import Callable, Dict, Any, Literal, Optional, Tuple, cast, overload

import langwatch
from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationResultWithMetadata,
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.dspy.predict_with_metadata import (
    PredictionWithMetadata,
)
from langwatch_nlp.studio.parser import parse_component
from langwatch_nlp.studio.types.dsl import Workflow, Node, Field
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule
import dspy

from langwatch_nlp.studio.utils import get_node_by_id, validate_identifier
from langevals_core.base_evaluator import SingleEvaluationResult, EvaluationResultError


class WorkflowModule(ReportingModule):
    def __init__(
        self,
        workflow: Workflow,
        manual_execution_mode: bool,
        until_node_id: Optional[str] = None,
        evaluation_weighting: Literal["mean"] = "mean",
        inputs: Optional[Dict[str, str]] = None,
    ):
        super().__init__()
        self.workflow = workflow
        self.components: Dict[str, dspy.Module] = {}
        self.until_node_id = until_node_id
        self.manual_execution_mode = manual_execution_mode
        self.evaluation_weighting = evaluation_weighting
        self.inputs = inputs

        for node in self.workflow.nodes:
            if node.type not in ["entry", "end"]:
                component = parse_component(node, workflow)
                self.components[node.id] = component()
                setattr(self, validate_identifier(node.id), self.components[node.id])

    def forward(self, **kwargs):
        try:
            langwatch.get_current_span().update(type="workflow")
        except Exception:
            pass
        return self.execute_workflow(kwargs)

    @overload
    def execute_node(
        self,
        node: Node,
        node_outputs: Dict[str, Dict[str, Any]],
        inputs: Dict[str, Any],
        return_inputs: Literal[False] = False,
    ) -> Dict[str, Any]: ...

    @overload
    def execute_node(
        self,
        node: Node,
        node_outputs: Dict[str, Dict[str, Any]],
        inputs: Dict[str, Any],
        return_inputs: Literal[True] = True,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]: ...

    def execute_node(
        self,
        node: Node,
        node_outputs: Dict[str, Dict[str, Any]],
        inputs: Dict[str, Any],
        return_inputs: bool = False,
    ):
        if node.type == "entry":
            return inputs
        elif node.type == "end":
            return None

        component = self.components[node.id]
        input_args = {}
        for edge in self.workflow.edges:
            if edge.target == node.id:
                source_node = get_node_by_id(self.workflow, edge.source)
                if source_node.type == "entry":
                    input_args[edge.targetHandle.split(".")[-1]] = inputs[
                        edge.sourceHandle.split(".")[-1]
                    ]
                else:
                    input_args[edge.targetHandle.split(".")[-1]] = node_outputs[
                        edge.source
                    ][edge.sourceHandle.split(".")[-1]]

        result = self.with_reporting(component, node.id)(**input_args)
        if return_inputs:
            return result, input_args
        return result

    def execute_workflow(self, inputs: Dict[str, Any]) -> dspy.Prediction:
        cost = 0
        duration = 0
        node_outputs: Dict[str, Dict[str, Any]] = {}
        error: Optional[Exception] = None

        start_time = time.time()
        try:
            end_node = next(
                (node for node in self.workflow.nodes if node.type == "end"), None
            )

            def has_all_inputs(node: Node) -> bool:
                required_inputs = set(
                    cast(Field, input).identifier for input in node.data.inputs or []
                )
                available_inputs = set()
                for edge in self.workflow.edges:
                    if edge.target == node.id:
                        source_node = get_node_by_id(self.workflow, edge.source)
                        if (
                            source_node.type == "entry"
                            or source_node.id in node_outputs
                        ):
                            available_inputs.add(edge.targetHandle.split(".")[-1])
                return required_inputs.issubset(available_inputs)

            # Execute nodes in topological order
            executed_nodes = set()
            executable_nodes = [
                node
                for node in self.workflow.nodes
                if node.type != "end"
                and node.type != "entry"
                and (node.type != "evaluator" or self.manual_execution_mode)
            ]
            loops = 0
            stop = False
            while len(executed_nodes) < len(executable_nodes):
                if loops >= len(executable_nodes):
                    raise Exception("Workflow has a loop")
                loops += 1
                for node in executable_nodes:
                    if node.id not in executed_nodes and has_all_inputs(node):
                        start_time = time.time()
                        result = self.execute_node(node, node_outputs, inputs) or {}
                        duration += round((time.time() - start_time) * 1000)
                        cost += result.get_cost() if hasattr(result, "get_cost") else 0  # type: ignore
                        node_outputs[node.id] = result  # type: ignore
                        executed_nodes.add(node.id)

                        if self.until_node_id and node.id == self.until_node_id:
                            stop = True
                            break
                if stop:
                    break

            # Prepare the final output
            final_output = {}
            if end_node:
                for edge in self.workflow.edges:
                    if edge.target == end_node.id:
                        source_node = get_node_by_id(self.workflow, edge.source)
                        final_output[edge.targetHandle.split(".")[-1]] = node_outputs[
                            source_node.id
                        ][edge.sourceHandle.split(".")[-1]]

            # Remove node_outputs that are not outputting to any evaluator
            node_outputs = {
                node_id: {
                    handle: outputs
                    for handle, outputs in outputs.items()
                    if any(
                        edge.source == node_id
                        and edge.sourceHandle.split(".")[-1] == handle
                        and get_node_by_id(self.workflow, edge.target).type
                        == "evaluator"
                        for edge in self.workflow.edges
                    )
                }
                for node_id, outputs in node_outputs.items()
                if any(
                    edge.source == node_id
                    and get_node_by_id(self.workflow, edge.target).type == "evaluator"
                    for edge in self.workflow.edges
                )
            }

            if end_node:
                node_outputs["end"] = final_output
        except Exception as e:
            error = e
            duration += round((time.time() - start_time) * 1000)
            if self.manual_execution_mode:
                raise e

        return PredictionWithEvaluationAndMetadata(
            evaluation=self.evaluate_prediction,
            cost=cost,
            duration=duration,
            error=error,
            **node_outputs,
        )

    def evaluate_prediction(
        self,
        example: dspy.Example,
        prediction: PredictionWithMetadata,
        trace: Optional[Any] = None,
        return_results: bool = False,
    ):
        prediction_error = prediction.get_error()
        evaluation_nodes = [
            node for node in self.workflow.nodes if node.type == "evaluator"
        ]

        if prediction_error:
            return 0, {
                node.id: EvaluationResultWithMetadata(
                    result=EvaluationResultError(
                        status="error",
                        error_type=type(prediction_error).__name__,
                        details=str(prediction_error),
                        traceback=[],
                    ),
                    inputs={},
                    duration=(
                        prediction.get_duration()
                        if hasattr(prediction, "get_duration")
                        else 0
                    ),
                )
                for node in evaluation_nodes
            }

        evaluation_results: Dict[str, EvaluationResultWithMetadata] = {}
        evaluation_scores: Dict[str, float] = {}

        for node in evaluation_nodes:
            start_time = time.time()

            try:
                result, inputs = self.execute_node(
                    node, dict(prediction), dict(example), return_inputs=True
                )
            except Exception as e:
                inputs = {}
                result = EvaluationResultError(
                    status="error",
                    error_type=type(e).__name__,
                    details=str(e),
                    traceback=[],
                )

            result = cast(SingleEvaluationResult, result)
            duration = round((time.time() - start_time) * 1000)
            evaluation_results[node.id] = EvaluationResultWithMetadata(
                result=result, inputs=inputs, duration=duration
            )
            if result.status == "processed":
                evaluation_scores[node.id] = result.score

        score = 0
        if self.evaluation_weighting == "mean":
            score = sum(evaluation_scores.values()) / max(len(evaluation_scores), 1)

        if return_results:
            return score, evaluation_results
        return score
