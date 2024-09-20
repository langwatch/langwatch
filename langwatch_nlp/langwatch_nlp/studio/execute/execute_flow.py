from multiprocessing import Queue
import time
from typing import Dict, Set
from langwatch_nlp.studio.parser import parse_workflow
from langwatch_nlp.studio.types.dsl import (
    ExecutionStatus,
    Field,
    Timestamps,
    Workflow,
    WorkflowExecutionState,
)
from langwatch_nlp.studio.types.events import (
    ExecuteFlowPayload,
    ExecutionStateChange,
    ExecutionStateChangePayload,
    StudioServerEvent,
)
from langwatch_nlp.studio.utils import disable_dsp_caching


async def execute_flow(event: ExecuteFlowPayload, queue: "Queue[StudioServerEvent]"):
    validate_workflow(event.workflow)

    workflow = event.workflow
    trace_id = event.trace_id
    until_node_id = event.until_node_id

    disable_dsp_caching()

    yield start_workflow_event(workflow, trace_id)

    Flow, _ = parse_workflow(workflow)
    module = Flow()
    module.set_reporting(queue=queue, trace_id=trace_id, workflow=workflow)
    result = module(question="what is the meaning of life?")
    print("\n\nresult", result, "\n\n")

    yield end_workflow_event(workflow, trace_id)


def start_workflow_event(workflow: Workflow, trace_id: str):
    return ExecutionStateChange(
        payload=ExecutionStateChangePayload(
            execution_state=WorkflowExecutionState(
                status=ExecutionStatus.running,
                trace_id=trace_id,
                timestamps=Timestamps(started_at=int(time.time() * 1000)),
            )
        )
    )


def end_workflow_event(workflow: Workflow, trace_id: str):
    return ExecutionStateChange(
        payload=ExecutionStateChangePayload(
            execution_state=WorkflowExecutionState(
                status=ExecutionStatus.success,
                trace_id=trace_id,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
            )
        )
    )


def validate_workflow(workflow: Workflow) -> None:
    connected_inputs: Dict[str, Set[str]] = {node.id: set() for node in workflow.nodes}

    # Map edges to connected inputs
    for edge in workflow.edges:
        target_id, target_field = edge.target, edge.targetHandle.split(".")[-1]
        connected_inputs[target_id].add(target_field)

    # Validate required inputs
    for node in workflow.nodes:
        if node.data.inputs:
            for input_field in node.data.inputs:
                if (
                    isinstance(input_field, Field)
                    and not input_field.optional
                    and input_field.identifier not in connected_inputs[node.id]
                ):
                    raise ValueError(
                        f"Missing required input '{input_field.identifier}' for node {node.id}"
                    )
