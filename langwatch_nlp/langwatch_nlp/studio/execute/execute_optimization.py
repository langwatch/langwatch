from contextlib import contextmanager
from io import StringIO
from multiprocessing import Queue
import sys
import time
from typing import Optional, cast
import dspy
import langwatch
from langwatch_nlp.studio.parser import parsed_and_materialized_workflow_class
from langwatch_nlp.studio.runtimes.base_runtime import ServerEventQueue
from langwatch_nlp.studio.dspy.evaluation import (
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.dspy.patched_boostrap_few_shot import (
    ExampleWithEntryMap,
    patch_labeled_few_shot_once,
)
from langwatch_nlp.studio.execute.execute_flow import (
    validate_workflow,
)
from langwatch_nlp.studio.types.dsl import (
    Entry,
    EntryNode,
    ExecutionStatus,
    OptimizationExecutionState,
    Timestamps,
)
from langwatch_nlp.studio.types.events import (
    ExecuteOptimizationPayload,
    OptimizationStateChange,
    OptimizationStateChangePayload,
    StudioServerEvent,
)
from langwatch_nlp.studio.utils import (
    get_input_keys,
    get_output_keys,
    node_llm_config_to_dspy_lm,
    transpose_inline_dataset_to_object_list,
)

from sklearn.model_selection import train_test_split

import dspy.primitives.module
from dspy.teleprompt import MIPROv2
from dspy.utils.asyncify import asyncify
from langwatch_nlp.studio.s3_cache import setup_s3_cache
import sentry_sdk

_original_postprocess_parameter_name = dspy.primitives.module.postprocess_parameter_name


def postprocess_parameter_name(name, value):
    if name.startswith("components['"):
        name = name.split("['")[1].split("']")[0]

    return _original_postprocess_parameter_name(name, value)


dspy.primitives.module.postprocess_parameter_name = postprocess_parameter_name


async def execute_optimization(
    event: ExecuteOptimizationPayload, queue: "ServerEventQueue"
):
    workflow = event.workflow
    run_id = event.run_id

    try:
        validate_workflow(workflow)

        # TODO: handle workflow errors here throwing an special event showing the error was during the execution of the workflow?
        yield start_optimization_event(run_id)

        if event.s3_cache_key:
            setup_s3_cache(event.s3_cache_key)

        with parsed_and_materialized_workflow_class(
            workflow,
            format=False,
            debug_level=0,
            do_not_trace=True,
        ) as (Module, _):
            module = Module(run_evaluations=True)

            entry_node = cast(
                EntryNode,
                next(node for node in workflow.nodes if isinstance(node.data, Entry)),
            )
            if not entry_node.data.dataset:
                raise ValueError("Missing dataset in entry node")
            assert entry_node.data.dataset.inline is not None, "Dataset inline is None"
            entries = transpose_inline_dataset_to_object_list(
                entry_node.data.dataset.inline
            )

            train_size = entry_node.data.train_size
            test_size = entry_node.data.test_size
            is_percentage = (train_size < 1) or (test_size < 1)
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

            train, test = train_test_split(
                examples,
                train_size=float(train_size) if is_percentage else int(train_size),
                test_size=float(test_size) if is_percentage else int(test_size),
                random_state=(seed if seed >= 0 else None),
                shuffle=(seed >= 0),
            )

            def metric(
                example: dspy.Example,
                pred: PredictionWithEvaluationAndMetadata,
                trace=None,
            ):
                score = pred.total_score(weighting="mean")
                return score

            langwatch.api_key = workflow.api_key

            params = event.params.model_dump(exclude_none=True)
            if event.optimizer == "MIPROv2ZeroShot" or event.optimizer == "MIPROv2":
                llm_config = event.params.llm
                if llm_config is None:
                    raise ValueError("LLM config is required for optimizer")
                lm = node_llm_config_to_dspy_lm(llm_config)
                # TODO: can we do it not globally? will this overwride the signature ones?
                # dspy.configure(lm=lm)

                optimizer = dspy.MIPROv2(
                    metric=metric,
                    num_candidates=params.get("num_candidates", 7) + 1,  # type: ignore
                    task_model=lm,
                    prompt_model=lm,
                    teacher_settings=dict(lm=lm),
                    num_threads=params.get("num_threads", 6),
                )
            elif event.optimizer == "BootstrapFewShotWithRandomSearch":
                optimizer = dspy.BootstrapFewShotWithRandomSearch(
                    metric=metric,
                    max_bootstrapped_demos=params.get("max_bootstrapped_demos", 4),
                    max_labeled_demos=params.get("max_labeled_demos", 16),
                    max_rounds=params.get("max_rounds", 1),
                    num_candidate_programs=params.get("num_candidate_programs", 10),
                    num_threads=params.get("num_threads", 6),
                )
                patch_labeled_few_shot_once()

            langwatch.dspy.init(
                run_id=run_id,
                experiment=f"{workflow.name} Optimizations",
                slug=f"{workflow.workflow_id}-optimizations",
                optimizer=optimizer,
                workflow_id=workflow.workflow_id,
                workflow_version_id=event.workflow_version_id,
            )

            with redirect_stdout_to_queue(queue, run_id):
                if event.optimizer == "MIPROv2ZeroShot":
                    optimizer = cast(MIPROv2, optimizer)
                    optimized_program = await asyncify(optimizer.compile)(
                        module,
                        trainset=train,
                        valset=test,
                        max_bootstrapped_demos=0,
                        max_labeled_demos=0,
                        num_trials=params.get("num_candidates", 7),
                        minibatch_size=params.get("minibatch_size", 25),
                        minibatch_full_eval_steps=params.get(
                            "minibatch_full_eval_steps", 10
                        ),
                        minibatch=params.get("minibatch", False),
                        requires_permission_to_run=False,
                    )
                elif event.optimizer == "MIPROv2":
                    optimizer = cast(MIPROv2, optimizer)
                    optimized_program = await asyncify(optimizer.compile)(
                        module,
                        trainset=train,
                        valset=test,
                        max_bootstrapped_demos=params.get("max_bootstrapped_demos", 4),
                        max_labeled_demos=params.get("max_labeled_demos", 16),
                        num_trials=params.get("num_trials", 30),
                        minibatch_size=params.get("minibatch_size", 25),
                        minibatch_full_eval_steps=params.get(
                            "minibatch_full_eval_steps", 10
                        ),
                        minibatch=params.get("minibatch", False),
                        requires_permission_to_run=False,
                    )
                elif event.optimizer == "BootstrapFewShotWithRandomSearch":
                    optimizer = cast(dspy.BootstrapFewShotWithRandomSearch, optimizer)
                    optimized_program = await asyncify(optimizer.compile)(
                        module, trainset=train, valset=test
                    )

    except Exception as e:
        yield error_optimization_event(
            run_id, str(e), stopped_at=int(time.time() * 1000)
        )
        # print stack trace
        import traceback

        traceback.print_exc()

        # TODO: report optimization as error
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

        # Capture error in Sentry
        sentry_sdk.capture_exception(
            e,
            extras={
                "run_id": run_id,
                "workflow_id": workflow.workflow_id,
                "workflow_version_id": event.workflow_version_id,
                "optimizer": event.optimizer,
            },
        )

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


class QueueWriter(StringIO):
    def __init__(
        self, queue: "Queue[StudioServerEvent]", run_id: str, original_stdout=None
    ):
        super().__init__()
        self.queue = queue
        self.run_id = run_id
        self.original_stdout = original_stdout
        self.buffer_text = ""
        self.last_timestamp = int(time.time() * 1000)

    def write(self, text: str):
        if self.original_stdout:
            self.original_stdout.write(text)

        if text.strip() != "":
            self.buffer_text += text
        current_timestamp = int(time.time() * 1000)

        if self.buffer_text != "" and (
            "\r" not in self.buffer_text
            or "100%|" in self.buffer_text
            or current_timestamp - self.last_timestamp > 100
        ):
            carriage_return_split = self.buffer_text.split("\r")
            if len(carriage_return_split) > 1:
                if self.buffer_text.endswith("\r"):
                    text = carriage_return_split[-2] + "\r"
                else:
                    text = "\r" + carriage_return_split[-1]
            else:
                text = self.buffer_text
            self.queue.put_nowait(
                OptimizationStateChange(
                    payload=OptimizationStateChangePayload(
                        optimization_state=OptimizationExecutionState(
                            stdout=text,
                        )
                    )
                )
            )
            self.last_timestamp = current_timestamp
            self.buffer_text = ""

    def flush(self):
        pass


@contextmanager
def redirect_stdout_to_queue(queue: "Queue[StudioServerEvent]", run_id: str):
    stdout = sys.stdout
    queue_writer_stdout = QueueWriter(queue, run_id, original_stdout=stdout)
    sys.stdout = queue_writer_stdout

    stderr = sys.stderr
    queue_writer_stderr = QueueWriter(queue, run_id, original_stdout=stderr)
    sys.stderr = queue_writer_stderr

    try:
        yield
    finally:
        sys.stdout = stdout
        sys.stderr = stderr
