from multiprocessing import Queue
import time
from typing import cast
import dspy
from langwatch_nlp.studio.dspy.evaluation import EvaluationReporting
from langwatch_nlp.studio.dspy.workflow_module import (
    WorkflowModule,
)
from langwatch_nlp.studio.execute.execute_flow import (
    validate_workflow,
)
from langwatch_nlp.studio.types.dsl import (
    Entry,
    EntryNode,
    EvaluationExecutionState,
    ExecutionStatus,
    Timestamps,
)
from langwatch_nlp.studio.types.events import (
    EvaluationStateChange,
    EvaluationStateChangePayload,
    ExecuteEvaluationPayload,
    StudioServerEvent,
)
from langwatch_nlp.studio.utils import (
    disable_dsp_caching,
    get_input_keys,
    transpose_inline_dataset_to_object_list,
)

from dspy.evaluate import Evaluate


async def execute_evaluation(
    event: ExecuteEvaluationPayload, queue: "Queue[StudioServerEvent]"
):
    validate_workflow(event.workflow)

    workflow = event.workflow
    run_id = event.run_id

    disable_dsp_caching()

    # TODO: handle workflow errors here throwing an special event showing the error was during the execution of the workflow?
    yield start_evaluation_event(run_id)

    module = WorkflowModule(workflow, execute_evaluators=False)

    entry_node = cast(
        EntryNode, next(node for node in workflow.nodes if isinstance(node.data, Entry))
    )
    if not entry_node.data.dataset:
        raise ValueError("Missing dataset in entry node")
    entries = transpose_inline_dataset_to_object_list(entry_node.data.dataset.inline)

    input_keys = get_input_keys(workflow)
    examples = [
        dspy.Example(_index=index, **entry).with_inputs(*input_keys)
        for index, entry in enumerate(entries)
    ]

    evaluator = Evaluate(
        devset=examples, num_threads=10, display_progress=False, display_table=False
    )

    reporting = EvaluationReporting(workflow, event.workflow_version_id, run_id)
    try:
        results = evaluator(module, metric=reporting.evaluate_and_report)
        await reporting.wait_for_completion()
    except Exception as e:
        yield error_evaluation_event(run_id, str(e))
        return

    yield end_evaluation_event(run_id)


def start_evaluation_event(run_id: str):
    return EvaluationStateChange(
        payload=EvaluationStateChangePayload(
            evaluation_state=EvaluationExecutionState(
                status=ExecutionStatus.running,
                run_id=run_id,
                timestamps=Timestamps(started_at=int(time.time() * 1000)),
            )
        )
    )


def end_evaluation_event(run_id: str):
    return EvaluationStateChange(
        payload=EvaluationStateChangePayload(
            evaluation_state=EvaluationExecutionState(
                status=ExecutionStatus.success,
                run_id=run_id,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
            )
        )
    )


def error_evaluation_event(run_id: str, error: str):
    return EvaluationStateChange(
        payload=EvaluationStateChangePayload(
            evaluation_state=EvaluationExecutionState(
                status=ExecutionStatus.error,
                run_id=run_id,
                error=error,
            )
        )
    )
