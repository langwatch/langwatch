import time
from typing import Optional, cast
import dspy
import sentry_sdk
from langwatch_nlp.studio.parser import parsed_and_materialized_workflow_class
from langwatch_nlp.studio.runtimes.base_runtime import ServerEventQueue
from langwatch_nlp.studio.dspy.evaluation import EvaluationReporting
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
)
from langwatch_nlp.studio.utils import (
    disable_dsp_caching,
    get_input_keys,
    transpose_inline_dataset_to_object_list,
)

from dspy.evaluate import Evaluate
from dspy.utils.asyncify import asyncify
from sklearn.model_selection import train_test_split


async def execute_evaluation(
    event: ExecuteEvaluationPayload, queue: "ServerEventQueue"
):
    workflow = event.workflow
    run_id = event.run_id
    valid = False

    try:
        validate_workflow(workflow)

        disable_dsp_caching()

        # TODO: handle workflow errors here throwing an special event showing the error was during the execution of the workflow?
        yield start_evaluation_event(run_id)
        valid = True

        with parsed_and_materialized_workflow_class(
            workflow,
            format=False,
            debug_level=0,
            do_not_trace=True,
        ) as Module:
            module = Module(run_evaluations=True)

            entry_node = cast(
                EntryNode,
                next(node for node in workflow.nodes if isinstance(node.data, Entry)),
            )
            if not entry_node.data.dataset:
                raise ValueError("Missing dataset in entry node")

            assert entry_node.data.dataset.inline is not None
            entries = transpose_inline_dataset_to_object_list(
                entry_node.data.dataset.inline
            )

            train_size = entry_node.data.train_size
            test_size = entry_node.data.test_size
            is_percentage = (train_size < 1) or (test_size < 1)
            seed = entry_node.data.seed

            if event.evaluate_on == "full":
                pass
            elif event.evaluate_on == "test":
                _, entries = train_test_split(
                    entries,
                    train_size=float(train_size) if is_percentage else int(train_size),
                    test_size=float(test_size) if is_percentage else int(test_size),
                    random_state=(seed if seed >= 0 else None),
                    shuffle=(seed >= 0),
                )
            elif event.evaluate_on == "train":
                entries, _ = train_test_split(
                    entries,
                    train_size=float(train_size) if is_percentage else int(train_size),
                    test_size=float(test_size) if is_percentage else int(test_size),
                    random_state=(seed if seed >= 0 else None),
                    shuffle=(seed >= 0),
                )
            else:
                raise ValueError(f"Invalid evaluate_on value: {event.evaluate_on}")

            input_keys = get_input_keys(workflow)
            examples = [
                dspy.Example(_index=index, **entry).with_inputs(*input_keys)
                for index, entry in enumerate(entries)
            ]

            evaluator = Evaluate(
                devset=examples,
                num_threads=10,
                display_progress=True,
                display_table=False,
                provide_traceback=True,
            )

            reporting = EvaluationReporting(
                workflow,
                event.workflow_version_id,
                run_id=run_id,
                total=len(examples),
                queue=queue,
                weighting="mean",
            )
            # Send initial empty batch to create the experiment in LangWatch
            reporting.send_batch()
            await asyncify(evaluator)(module, metric=reporting.evaluate_and_report) # type: ignore
            await reporting.wait_for_completion()
    except Exception as e:
        yield error_evaluation_event(run_id, str(e), stopped_at=int(time.time() * 1000))
        if valid:
            sentry_sdk.capture_exception(
                e,
                extras={
                    "run_id": run_id,
                    "workflow_id": workflow.workflow_id,
                    "workflow_version_id": event.workflow_version_id,
                },
            )
            EvaluationReporting.post_results(
                workflow.api_key,
                {
                    "experiment_id": workflow.experiment_id,
                    "experiment_slug": (
                        None if workflow.experiment_id else workflow.workflow_id
                    ),
                    "run_id": run_id,
                    "timestamps": {
                        "finished_at": int(time.time() * 1000),
                        "stopped_at": int(time.time() * 1000),
                    },
                },
            )
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


def error_evaluation_event(run_id: str, error: str, stopped_at: Optional[int] = None):
    return EvaluationStateChange(
        payload=EvaluationStateChangePayload(
            evaluation_state=EvaluationExecutionState(
                status=ExecutionStatus.error,
                run_id=run_id,
                error=error,
                timestamps=Timestamps(
                    finished_at=int(time.time() * 1000),
                    stopped_at=stopped_at,
                ),
            )
        )
    )
