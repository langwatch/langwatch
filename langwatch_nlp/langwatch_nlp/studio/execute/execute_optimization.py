from multiprocessing import Queue
import time
from typing import Optional, cast
import dspy
import langwatch
from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationReporting,
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.dspy.patched_boostrap_few_shot import (
    ExampleWithEntryMap,
    patch_labeled_few_shot_once,
)
from langwatch_nlp.studio.dspy.workflow_module import (
    WorkflowModule,
)
from langwatch_nlp.studio.execute.execute_flow import (
    validate_workflow,
)
from langwatch_nlp.studio.modules.registry import OPTIMIZERS
from langwatch_nlp.studio.types.dsl import (
    Entry,
    EntryNode,
    EvaluationExecutionState,
    ExecutionStatus,
    Node,
    OptimizationExecutionState,
    Timestamps,
)
from langwatch_nlp.studio.types.events import (
    EvaluationStateChange,
    EvaluationStateChangePayload,
    ExecuteEvaluationPayload,
    ExecuteOptimizationPayload,
    OptimizationStateChange,
    OptimizationStateChangePayload,
    StudioServerEvent,
)
from langwatch_nlp.studio.utils import (
    disable_dsp_caching,
    get_input_keys,
    get_output_keys,
    transpose_inline_dataset_to_object_list,
)

from dspy.evaluate import Evaluate
from sklearn.model_selection import train_test_split

import dspy.primitives.module

_original_postprocess_parameter_name = dspy.primitives.module.postprocess_parameter_name


def postprocess_parameter_name(name, value):
    if name.startswith("components['"):
        name = name.split("['")[1].split("']")[0]

    return _original_postprocess_parameter_name(name, value)


dspy.primitives.module.postprocess_parameter_name = postprocess_parameter_name


async def execute_optimization(
    event: ExecuteOptimizationPayload, queue: "Queue[StudioServerEvent]"
):
    workflow = event.workflow
    run_id = event.run_id

    valid = False

    try:
        validate_workflow(workflow)

        disable_dsp_caching()

        # TODO: handle workflow errors here throwing an special event showing the error was during the execution of the workflow?
        yield start_optimization_event(run_id)
        valid = True

        module = WorkflowModule(workflow, manual_execution_mode=False)

        entry_node = cast(
            EntryNode,
            next(node for node in workflow.nodes if isinstance(node.data, Entry)),
        )
        if not entry_node.data.dataset:
            raise ValueError("Missing dataset in entry node")
        entries = transpose_inline_dataset_to_object_list(
            entry_node.data.dataset.inline
        )

        test_size = entry_node.data.train_test_split
        seed = entry_node.data.seed

        input_keys = get_input_keys(workflow)
        all_keys = set(input_keys + get_output_keys(workflow))
        examples = [
            ExampleWithEntryMap(
                _index=index, **{k: v for k, v in entry.items() if k in all_keys}
            )
            .with_inputs(*input_keys)
            .with_map_from_workflow(workflow)
            for index, entry in enumerate(entries)
        ]

        train, test = train_test_split(examples, test_size=test_size, random_state=seed)

        def metric(
            example: dspy.Example,
            pred: PredictionWithEvaluationAndMetadata,
            trace=None,
        ):
            score, results = pred.evaluation(example, trace=trace, return_results=True)
            return score

        langwatch.api_key = workflow.api_key

        params = event.params.model_dump(exclude_none=True)
        optimizer = OPTIMIZERS[event.optimizer](metric=metric, **params)

        if event.optimizer == "BootstrapFewShotWithRandomSearch":
            patch_labeled_few_shot_once()

        langwatch.dspy.init(
            run_id=run_id,
            experiment=f"{workflow.name} Optimizations",
            slug=f"{workflow.workflow_id}-optimizations",
            optimizer=optimizer,
            workflow_id=workflow.workflow_id,
            workflow_version_id=event.workflow_version_id,
        )

        optimized_program = optimizer.compile(module, trainset=train)

        # print("\n\noptimized_program", optimized_program, "\n\n")

        ## optimize

    except Exception as e:
        yield error_optimization_event(
            run_id, str(e), stopped_at=int(time.time() * 1000)
        )
        # print stack trace
        import traceback

        traceback.print_exc()
        # if valid:
        #     EvaluationReporting.post_results(
        #         workflow.api_key,
        #         {
        #             "experiment_slug": workflow.workflow_id,
        #             "run_id": run_id,
        #             "timestamps": {
        #                 "finished_at": int(time.time() * 1000),
        #                 "stopped_at": int(time.time() * 1000),
        #             },
        #         },
        #     )
        return

    yield end_optimization_event(run_id)


def start_optimization_event(run_id: str):
    return OptimizationStateChange(
        payload=OptimizationStateChangePayload(
            optimization_state=OptimizationExecutionState(
                status=ExecutionStatus.running,
                run_id=run_id,
                timestamps=Timestamps(started_at=int(time.time() * 1000)),
            )
        )
    )


def end_optimization_event(run_id: str):
    return OptimizationStateChange(
        payload=OptimizationStateChangePayload(
            optimization_state=OptimizationExecutionState(
                status=ExecutionStatus.success,
                run_id=run_id,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
            )
        )
    )


def error_optimization_event(run_id: str, error: str, stopped_at: Optional[int] = None):
    return OptimizationStateChange(
        payload=OptimizationStateChangePayload(
            optimization_state=OptimizationExecutionState(
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
