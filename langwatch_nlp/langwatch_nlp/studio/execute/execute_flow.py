import asyncio
import time
from typing import Any, Dict, Set
from langwatch_nlp.studio.execute.execute_component import (
    end_component_event,
    start_component_event,
    component_error_event,
)
from langwatch_nlp.studio.parser import parse_component
from langwatch_nlp.studio.types.dsl import (
    ExecutionState,
    ExecutionStatus,
    Field,
    Node,
    Timestamps,
    Workflow,
    WorkflowExecutionState,
)
from langwatch_nlp.studio.types.events import (
    ComponentStateChange,
    ComponentStateChangePayload,
    ExecuteFlowPayload,
    ExecutionStateChange,
    ExecutionStateChangePayload,
)
from langwatch_nlp.studio.utils import disable_dsp_caching


async def execute_flow(event: ExecuteFlowPayload):
    validate_workflow(event.workflow)

    workflow = event.workflow
    trace_id = event.trace_id
    until_node_id = event.until_node_id

    disable_dsp_caching()

    yield start_workflow_event(workflow, trace_id)

    # Build a map of node outputs
    node_outputs: Dict[str, Dict[str, str]] = {node.id: {} for node in workflow.nodes}

    # Build a map of node dependencies
    dependencies: Dict[str, Set[str]] = {node.id: set() for node in workflow.nodes}
    for edge in workflow.edges:
        dependencies[edge.target].add(edge.source)

    # Build a map of nodes ready to execute
    ready_nodes = set(node.id for node in workflow.nodes if node.type == "entry")

    if not ready_nodes:
        raise ValueError("No entry node found in workflow")

    async def execute_node(node: Node, inputs: Dict[str, Any]):
        module = parse_component(node, workflow)
        result = await module(**inputs)
        return result._store

    while ready_nodes:
        # Start execution for all ready nodes
        tasks = {}
        for node_id in ready_nodes:
            node = next(node for node in workflow.nodes if node.id == node_id)
            inputs = {}
            for edge in workflow.edges:
                if edge.target == node_id:
                    source_node_id, source_field = (
                        edge.source,
                        edge.sourceHandle.split(".")[-1],
                    )
                    inputs[edge.targetHandle.split(".")[-1]] = node_outputs[
                        source_node_id
                    ][source_field]

            yield start_component_event(node, trace_id)
            tasks[node_id] = asyncio.create_task(execute_node(node, inputs))

        # Wait for tasks to complete and yield their results as they finish
        for completed_task in asyncio.as_completed(tasks.values()):
            try:
                result = await completed_task
                node_id = next(
                    id for id, task in tasks.items() if task == completed_task
                )
                node = next(node for node in workflow.nodes if node.id == node_id)
                yield end_component_event(node, trace_id, result)
                node_outputs[node_id] = result
            except Exception as e:
                # Handle error case
                node_id = next(
                    id for id, task in tasks.items() if task == completed_task
                )
                node = next(node for node in workflow.nodes if node.id == node_id)
                yield ComponentStateChange(
                    payload=ComponentStateChangePayload(
                        component_id=node_id,
                        execution_state=ExecutionState(
                            status=ExecutionStatus.error,
                            trace_id=trace_id,
                            timestamps=Timestamps(finished_at=int(time.time() * 1000)),
                            error=str(e),
                        ),
                    )
                )
                yield component_error_event(
                    trace_id=trace_id,
                    node_id=node_id,
                    error=repr(e),
                )

        # Update ready_nodes
        completed_nodes = set(node_outputs.keys())
        ready_nodes = set()
        for node_id, deps in dependencies.items():
            if not deps.difference(completed_nodes) and node_id not in completed_nodes:
                ready_nodes.add(node_id)

        if until_node_id and until_node_id in completed_nodes:
            break

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
