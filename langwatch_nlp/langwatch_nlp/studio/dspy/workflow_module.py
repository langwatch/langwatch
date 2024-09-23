from typing import Callable, Dict, Any, Literal, Optional, cast
from langwatch_nlp.studio.parser import parse_component
from langwatch_nlp.studio.types.dsl import Workflow, Node, Field
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule
import dspy

from langwatch_nlp.studio.utils import validate_identifier
from langevals_core.base_evaluator import (
    SingleEvaluationResult,
)


class WorkflowModule(ReportingModule):
    def __init__(
        self,
        workflow: Workflow,
        execute_evaluators: bool = False,
        until_node_id: Optional[str] = None,
        evaluation_weighting: Literal["mean"] = "mean",
    ):
        super().__init__()
        self.workflow = workflow
        self.components: Dict[str, dspy.Module] = {}
        self.until_node_id = until_node_id
        self.execute_evaluators = execute_evaluators
        self.evaluation_weighting = evaluation_weighting

        for node in self.workflow.nodes:
            if node.type not in ["entry", "end"]:
                component = parse_component(node, workflow)
                self.components[node.id] = component()
                setattr(self, validate_identifier(node.id), self.components[node.id])

    def forward(self, **kwargs):
        return self.execute_workflow(kwargs)

    def get_node_by_id(self, node_id: str) -> Node:
        return next(node for node in self.workflow.nodes if node.id == node_id)

    def execute_node(
        self,
        node: Node,
        node_outputs: Dict[str, Dict[str, Any]],
        inputs: Dict[str, Any],
    ):
        if node.type == "entry":
            return inputs
        elif node.type == "end":
            return None

        component = self.components[node.id]
        input_args = {}
        for edge in self.workflow.edges:
            if edge.target == node.id:
                source_node = self.get_node_by_id(edge.source)
                if source_node.type == "entry":
                    input_args[edge.targetHandle.split(".")[-1]] = inputs[
                        edge.sourceHandle.split(".")[-1]
                    ]
                else:
                    input_args[edge.targetHandle.split(".")[-1]] = node_outputs[
                        edge.source
                    ][edge.sourceHandle.split(".")[-1]]

        return self.with_reporting(component, node.id)(**input_args)

    def execute_workflow(self, inputs: Dict[str, Any]) -> dspy.Prediction:
        node_outputs: Dict[str, Dict[str, Any]] = {}
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
                    source_node = self.get_node_by_id(edge.source)
                    if source_node.type == "entry" or source_node.id in node_outputs:
                        available_inputs.add(edge.targetHandle.split(".")[-1])
            return required_inputs.issubset(available_inputs)

        # Execute nodes in topological order
        executed_nodes = set()
        executable_nodes = [
            node
            for node in self.workflow.nodes
            if node.type != "end"
            and node.type != "entry"
            and (node.type != "evaluator" or self.execute_evaluators)
        ]
        loops = 0
        stop = False
        while len(executed_nodes) < len(executable_nodes):
            if loops >= len(executable_nodes):
                raise Exception("Workflow has a loop")
            loops += 1
            for node in executable_nodes:
                if node.id not in executed_nodes and has_all_inputs(node):
                    node_outputs[node.id] = (
                        self.execute_node(node, node_outputs, inputs) or {}
                    )
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
                    source_node = self.get_node_by_id(edge.source)
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
                    and self.get_node_by_id(edge.target).type == "evaluator"
                    for edge in self.workflow.edges
                )
            }
            for node_id, outputs in node_outputs.items()
            if any(
                edge.source == node_id
                and self.get_node_by_id(edge.target).type == "evaluator"
                for edge in self.workflow.edges
            )
        }

        if end_node:
            node_outputs["end"] = final_output

        return PredictionWithEvaluation(
            evaluation=self.evaluate_prediction,
            **node_outputs,
        )

    def evaluate_prediction(
        self,
        example: dspy.Example,
        prediction: dspy.Prediction,
        trace: Optional[Any] = None,
        return_results: bool = False,
    ):
        evaluation_nodes = [
            node for node in self.workflow.nodes if node.type == "evaluator"
        ]

        evaluation_results: Dict[str, SingleEvaluationResult] = {}
        evaluation_scores: Dict[str, float] = {}

        for node in evaluation_nodes:
            result = cast(
                SingleEvaluationResult,
                self.execute_node(node, dict(prediction), dict(example)),
            )
            evaluation_results[node.id] = result
            if result.status == "processed":
                evaluation_scores[node.id] = result.score

        score = 0
        if self.evaluation_weighting == "mean":
            score = sum(evaluation_scores.values()) / max(len(evaluation_scores), 1)

        if return_results:
            return score, evaluation_results
        return score


class PredictionWithEvaluation(dspy.Prediction):
    def __init__(
        self,
        evaluation: Callable[
            [dspy.Example, dspy.Prediction, Optional[Any], bool],
            bool | float | tuple[float, dict],
        ],
        **kwargs
    ):
        super().__init__(**kwargs)
        self._evaluation = evaluation

    def evaluation(
        self,
        example,
        trace=None,
        return_results=False,
    ) -> bool | float | tuple[float, dict]:
        return self._evaluation(example, self, trace, return_results)