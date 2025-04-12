from contextlib import asynccontextmanager
import os
import signal
import langwatch_nlp.studio.runtimes.lambda_runtime as lambda_runtime
from langwatch_nlp.logger import get_logger
from langwatch_nlp.studio.s3_cache import s3_client_and_bucket
from langwatch_nlp.studio.runtimes.base_runtime import BaseRuntime
import langwatch_nlp.error_tracking
import asyncio
from queue import Empty
import time
from typing import Any, AsyncGenerator, Union, cast
from fastapi import FastAPI, Request, Response, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
import json

from langwatch_nlp.studio.dspy.evaluation import EvaluationReporting
from langwatch_nlp.studio.execute.execute_evaluation import (
    error_evaluation_event,
)
from langwatch_nlp.studio.execute.execute_optimization import (
    error_optimization_event,
)
from langwatch_nlp.studio.runtimes.async_runtime import AsyncRuntime
from langwatch_nlp.studio.runtimes.isolated_process_pool import (
    IsolatedProcessPoolRuntime,
)
from langwatch_nlp.studio.types.events import (
    Done,
    ExecuteComponent,
    ExecuteEvaluation,
    ExecuteFlow,
    ExecuteOptimization,
    ExecutionStateChange,
    StopEvaluationExecution,
    StopExecution,
    StopOptimizationExecution,
    StudioClientEvent,
    StudioServerEvent,
    Error,
    ErrorPayload,
    component_error_event,
    get_trace_id,
)
from langwatch_nlp.studio.utils import SerializableAndPredictEncoder, shutdown_handler

logger = get_logger(__name__)

runtime_env = os.getenv("STUDIO_RUNTIME", "isolated_process_pool")
runtime = cast(
    Union[AsyncRuntime, IsolatedProcessPoolRuntime],
    {
        "async": AsyncRuntime(),
        "isolated_process_pool": IsolatedProcessPoolRuntime(),
    }[runtime_env],
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await runtime.startup()

    if os.getenv("RUNNING_IN_DOCKER"):
        signal.signal(signal.SIGTERM, shutdown_handler)
        signal.signal(signal.SIGINT, shutdown_handler)

    yield

    await runtime.shutdown()


app = FastAPI(lifespan=lifespan)


async def handle_interruption(event: StudioClientEvent):
    # TODO: maybe we should handle this always based on the target event being interrupted not the stop event?
    if (
        isinstance(event, StopExecution)
        or isinstance(event, ExecuteComponent)
        or isinstance(event, ExecuteFlow)
    ):
        if hasattr(event.payload, "node_id") and event.payload.node_id:  # type: ignore
            return component_error_event(
                trace_id=event.payload.trace_id,
                node_id=event.payload.node_id,  # type: ignore
                error="Interrupted",
            )
        else:
            return Error(payload=ErrorPayload(message="Interrupted"))

    if isinstance(event, StopEvaluationExecution) or isinstance(
        event, ExecuteEvaluation
    ):
        EvaluationReporting.post_results(
            event.payload.workflow.api_key,
            {
                "experiment_id": event.payload.workflow.experiment_id,
                "experiment_slug": (
                    None
                    if event.payload.workflow.experiment_id
                    else event.payload.workflow.workflow_id
                ),
                "run_id": event.payload.run_id,
                "timestamps": {
                    "finished_at": int(time.time() * 1000),
                    "stopped_at": int(time.time() * 1000),
                },
            },
        )
        return error_evaluation_event(
            run_id=event.payload.run_id,
            error="Evaluation Stopped",
            stopped_at=int(time.time() * 1000),
        )

    if isinstance(event, StopOptimizationExecution) or isinstance(
        event, ExecuteOptimization
    ):
        return error_optimization_event(
            run_id=event.payload.run_id,
            error="Optimization Stopped",
            stopped_at=int(time.time() * 1000),
        )


async def stop_process(event: StudioClientEvent, s3_cache_key: str | None = None):
    trace_id = get_trace_id(event)
    if not trace_id:
        return None

    if s3_cache_key:
        lambda_runtime.stop_process(trace_id, s3_cache_key)
    elif trace_id in runtime.running_processes:
        await runtime.stop_process(trace_id)
        return await handle_interruption(event)

    return None


# We execute events on a subprocess because each user might execute completely different code,
# which can alter the global Python interpreter state in unpredictable ways. DSPy itself does
# a lot of this. At same time, we want to fork the main process to avoid double RAM spending and
# startup times.
async def execute_event_on_a_subprocess(
    event: StudioClientEvent, s3_cache_key: str | None = None
):
    if (
        isinstance(event, StopExecution)
        or isinstance(event, StopEvaluationExecution)
        or isinstance(event, StopOptimizationExecution)
    ):
        if stop_event := await stop_process(event, s3_cache_key):
            yield stop_event
        return

    process, queue = await runtime.submit(event)

    if s3_cache_key and (trace_id := get_trace_id(event)):
        lambda_runtime.setup_kill_signal_watcher(event, queue, s3_cache_key, trace_id)

    process = cast(Any, process)

    timeout_without_messages = 120  # seconds
    if isinstance(event, ExecuteOptimization):
        # TODO: temporary until we actually send events in the middle of optimization process
        timeout_without_messages = 120 * 60  # 120 minutes

    try:
        done = False
        last_message_time = time.time()
        time_since_last_message = 0
        while time_since_last_message < timeout_without_messages:
            time_since_last_message = time.time() - last_message_time
            try:
                result = queue.get_nowait()
                yield result
                last_message_time = time.time()

                if isinstance(result, Done):
                    done = True
                    break
            except (Empty, asyncio.QueueEmpty):
                if timeout_without_messages > 10 and not runtime.is_process_alive(
                    process
                ):
                    raise Exception("Runtime crashed")

                await asyncio.sleep(0.1)

        if not done:
            # Timeout occurred
            yield Error(payload=ErrorPayload(message="Execution timed out"))
            runtime.kill_process(process)

    except Exception as e:
        import traceback

        traceback.print_exc()
        yield Error(payload=ErrorPayload(message=f"Unexpected error: {repr(e)}"))
    finally:
        # Ensure the process is terminated and resources are cleaned up
        trace_id = get_trace_id(event)
        runtime.cleanup(trace_id, process)


async def event_encoder(event_generator: AsyncGenerator[StudioServerEvent, None]):
    async for event in event_generator:
        yield f"data: {json.dumps(event.model_dump(exclude_none=True), cls=SerializableAndPredictEncoder)}\n\n"


@app.post("/execute")
async def execute(
    event: StudioClientEvent,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
):
    response.headers["Cache-Control"] = "no-cache"
    s3_cache_key = request.headers.get("X-S3-Cache-Key", None)
    if s3_cache_key and isinstance(event, ExecuteOptimization):
        event.payload.s3_cache_key = s3_cache_key

    return StreamingResponse(
        event_encoder(execute_event_on_a_subprocess(event, s3_cache_key)),
        media_type="text/event-stream",
    )


@app.post("/execute_sync")
async def execute_sync(event: StudioClientEvent):
    event_stream = execute_event_on_a_subprocess(event)

    # Monitor the stream for the "success" state
    async for response in event_stream:
        if isinstance(response, ExecutionStateChange):
            status = response.payload.execution_state.status

            if status == "success":
                return {
                    "trace_id": response.payload.execution_state.trace_id,
                    "status": "success",
                    "result": (
                        response.payload.execution_state.result.get("end")
                        if response.payload.execution_state.result
                        else None
                    ),
                }
            elif status == "error":
                raise HTTPException(
                    status_code=500, detail=response.payload.execution_state.error
                )

    # If the loop completes without finding success or error
    raise HTTPException(
        status_code=500, detail="Execution completed without success or error status"
    )
