import json
import time
from typing import Dict, Set, cast

import dspy
import asyncer
import sentry_sdk
from langwatch_nlp.studio.parser_v2 import (
    parsed_and_materialized_workflow_class,
)
from langwatch_nlp.studio.runtimes.base_runtime import ServerEventQueue
from langwatch_nlp.studio.types.dsl import (
    Entry,
    EntryNode,
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
)
from langwatch_nlp.studio.utils import (
    ClientReadableValueError,
    SerializableWithPydanticAndPredictEncoder,
    disable_dsp_caching,
    optional_langwatch_trace,
    transpose_inline_dataset_to_object_list,
)


async def execute_flow(
    event: ExecuteFlowPayload,
    queue: "ServerEventQueue",
):
    validate_workflow(event.workflow)

    workflow = event.workflow
    trace_id = event.trace_id
    until_node_id = event.until_node_id
    inputs = event.inputs
    manual_execution_mode = (
        True if event.manual_execution_mode is None else event.manual_execution_mode
    )

    do_not_trace = not workflow.enable_tracing or (
        inputs[0].get("do_not_trace", event.do_not_trace)
        if inputs
        else event.do_not_trace
    )

    disable_dsp_caching()

    # TODO: handle workflow errors here throwing an special event showing the error was during the execution of the workflow?
    yield start_workflow_event(workflow, trace_id)

    try:
        with optional_langwatch_trace(
            do_not_trace=do_not_trace,
            trace_id=event.trace_id,
            api_key=event.workflow.api_key,
            skip_root_span=True,
            metadata={
                "platform": "optimization_studio",
                "environment": "development" if manual_execution_mode else "production",
            },
        ) as trace:
            if not do_not_trace and trace:
                trace.autotrack_dspy()

            with parsed_and_materialized_workflow_class(
                workflow,
                format=False,
                debug_level=0,
                until_node_id=until_node_id,
                do_not_trace=do_not_trace,
            ) as Module:
                module = Module(run_evaluations=True)
                module.set_reporting(queue=queue, trace_id=trace_id, workflow=workflow)

                entry_node = cast(
                    EntryNode,
                    next(
                        node for node in workflow.nodes if isinstance(node.data, Entry)
                    ),
                )
                if not entry_node.data.dataset:
                    raise ValueError("Missing dataset in entry node")

                if inputs:
                    entries = inputs

                else:
                    if not entry_node.data.dataset.inline:
                        raise ValueError("Missing inline dataset in entry node")
                    entries = transpose_inline_dataset_to_object_list(
                        entry_node.data.dataset.inline
                    )

                if len(entries) == 0:
                    raise ClientReadableValueError(
                        "Dataset is empty, please add at least one entry and try again"
                    )

                try:
                    result = await dspy.asyncify(module.forward)(**entries[0])  # type: ignore

                except Exception as e:
                    import traceback

                    traceback.print_exc()
                    yield error_workflow_event(trace_id, str(e))
                    sentry_sdk.capture_exception(
                        e,
                        extras={
                            "trace_id": trace_id,
                            "workflow_id": workflow.workflow_id,
                        },
                    )
                    return

        # cost = result.cost if hasattr(result, "cost") else None

        yield end_workflow_event(workflow, trace_id, result)
    finally:
        if trace:
            await asyncer.asyncify(trace.send_spans)()


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


def end_workflow_event(workflow: Workflow, trace_id: str, result):
    return ExecutionStateChange(
        payload=ExecutionStateChangePayload(
            execution_state=WorkflowExecutionState(
                status=ExecutionStatus.success,
                trace_id=trace_id,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
                result=json.loads(
                    json.dumps(result.toDict(), cls=SerializableWithPydanticAndPredictEncoder)
                ),
            )
        )
    )


def error_workflow_event(trace_id: str, error: str):
    return ExecutionStateChange(
        payload=ExecutionStateChangePayload(
            execution_state=WorkflowExecutionState(
                status=ExecutionStatus.error,
                trace_id=trace_id,
                error=error,
            )
        )
    )


def validate_workflow(workflow: Workflow) -> None:
    connected_inputs: Dict[str, Set[str]] = {node.id: set() for node in workflow.nodes}

    entry_node = next(
        (node for node in workflow.nodes if isinstance(node.data, Entry)), None
    )
    if not entry_node:
        raise ClientReadableValueError("Entry node is missing")

    # Map edges to connected inputs
    for edge in workflow.edges:
        target_id, target_field = edge.target, edge.targetHandle.split(".")[-1]
        connected_inputs[target_id].add(target_field)

    # Validate required inputs
    connected_nodes = set(x.target for x in workflow.edges)
    for node in workflow.nodes:
        if node.id not in connected_nodes:
            continue
        if node.data.inputs:
            for input_field in node.data.inputs:
                if (
                    isinstance(input_field, Field)
                    and not input_field.optional
                    and input_field.identifier not in connected_inputs[node.id]
                ):
                    raise ClientReadableValueError(
                        f"Missing required input '{input_field.identifier}' for node {node.id}"
                    )
