from contextlib import asynccontextmanager
import os
import signal
import langwatch_nlp.error_tracking
import asyncio
from queue import Empty
import time
from typing import AsyncGenerator
from fastapi import FastAPI, Response, BackgroundTasks, HTTPException
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
from langwatch_nlp.studio.utils import shutdown_handler


runtime = IsolatedProcessPoolRuntime()
# runtime = AsyncRuntime()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await runtime.startup()

    if os.getenv("RUNNING_IN_DOCKER"):
        signal.signal(signal.SIGTERM, shutdown_handler)
        signal.signal(signal.SIGINT, shutdown_handler)

    yield

    await runtime.shutdown()


app = FastAPI(lifespan=lifespan)


# We execute events on a subprocess because each user might execute completely different code,
# which can alter the global Python interpreter state in unpredictable ways. DSPy itself does
# a lot of this. At same time, we want to fork the main process to avoid double RAM spending and
# startup times.
async def execute_event_on_a_subprocess(event: StudioClientEvent):
    if isinstance(event, StopExecution):
        if event.payload.trace_id in runtime.running_processes:
            await runtime.stop_process(event.payload.trace_id)
            if event.payload.node_id:
                yield component_error_event(
                    trace_id=event.payload.trace_id,
                    node_id=event.payload.node_id,
                    error="Interrupted",
                )
            else:
                yield Error(payload=ErrorPayload(message="Interrupted"))
        return

    if isinstance(event, StopEvaluationExecution):
        if event.payload.run_id in runtime.running_processes:
            await runtime.stop_process(event.payload.run_id)
            EvaluationReporting.post_results(
                event.payload.workflow.api_key,
                {
                    "experiment_slug": event.payload.workflow.workflow_id,
                    "run_id": event.payload.run_id,
                    "timestamps": {
                        "finished_at": int(time.time() * 1000),
                        "stopped_at": int(time.time() * 1000),
                    },
                },
            )
            yield error_evaluation_event(
                run_id=event.payload.run_id,
                error="Evaluation Stopped",
                stopped_at=int(time.time() * 1000),
            )
        return

    if isinstance(event, StopOptimizationExecution):
        if event.payload.run_id in runtime.running_processes:
            await runtime.stop_process(event.payload.run_id)
            yield error_optimization_event(
                run_id=event.payload.run_id,
                error="Optimization Stopped",
                stopped_at=int(time.time() * 1000),
            )
        return

    process, queue = await runtime.submit(event)

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
                result = queue.get(block=False)
                yield result
                last_message_time = time.time()

                if isinstance(result, Done):
                    done = True
                    break
            except Empty:
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
        yield Error(payload=ErrorPayload(message=f"Unexpected error: {repr(e)}"))
    finally:
        # Ensure the process is terminated and resources are cleaned up
        trace_id = get_trace_id(event)
        runtime.cleanup(trace_id, process)


async def event_encoder(event_generator: AsyncGenerator[StudioServerEvent, None]):
    async for event in event_generator:
        yield f"data: {json.dumps(event.model_dump(exclude_none=True))}\n\n"


@app.post("/execute")
async def execute(
    event: StudioClientEvent, response: Response, background_tasks: BackgroundTasks
):
    response.headers["Cache-Control"] = "no-cache"
    return StreamingResponse(
        event_encoder(execute_event_on_a_subprocess(event)),
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
