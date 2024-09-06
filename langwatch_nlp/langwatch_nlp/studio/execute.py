import asyncio
from contextlib import asynccontextmanager
from multiprocessing import Process, Queue
from multiprocessing.synchronize import Event
import os
from queue import Empty
import queue
import time
from typing import AsyncGenerator, Dict, TypedDict
from fastapi import FastAPI, Response, BackgroundTasks
from fastapi.responses import StreamingResponse
import json
import dspy

from langwatch_nlp.studio.parser import parse_component
from langwatch_nlp.studio.process_pool import IsolatedProcessPool
from langwatch_nlp.studio.types.dsl import (
    ComponentExecutionStatus,
    ExecutionState,
    Timestamps,
)
from langwatch_nlp.studio.utils import disable_dsp_caching
from .types.events import (
    ComponentStateChange,
    ComponentStateChangePayload,
    Debug,
    DebugPayload,
    Done,
    ExecuteComponentPayload,
    IsAliveResponse,
    StopExecution,
    StudioClientEvent,
    StudioServerEvent,
    Error,
    ErrorPayload,
)

pool: IsolatedProcessPool[StudioClientEvent, StudioServerEvent]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    pool = IsolatedProcessPool(event_worker, size=4)

    yield

    pool.shutdown()


app = FastAPI(lifespan=lifespan)


async def execute_component(event: ExecuteComponentPayload):
    yield Debug(payload=DebugPayload(message="executing component"))

    started_at = int(time.time() * 1000)

    yield ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=event.node_id,
            execution_state=ExecutionState(
                status=ComponentExecutionStatus.running,
                trace_id=event.trace_id,
                timestamps=Timestamps(started_at=started_at),
            ),
        )
    )

    node = [node for node in event.workflow.nodes if node.id == event.node_id][0]

    component = parse_component(node)

    module = (
        dspy.Predict(component)
        if issubclass(component, dspy.Signature)
        else component()
    )

    lm = dspy.OpenAI(model="gpt-4o-mini", max_tokens=2048)
    dspy.settings.configure(experimental=True)
    disable_dsp_caching()
    module.set_lm(lm=lm)

    result = module(**event.inputs)

    yield ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=event.node_id,
            execution_state=ExecutionState(
                status=ComponentExecutionStatus.success,
                trace_id=event.trace_id,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
                outputs=result._store,
            ),
        )
    )


async def execute_event(
    event: StudioClientEvent,
) -> AsyncGenerator[StudioServerEvent, None]:
    yield Debug(payload=DebugPayload(message="server starting execution"))

    try:
        match event.type:
            case "is_alive":
                yield IsAliveResponse()
            case "execute_component":
                try:
                    async for event_ in execute_component(event.payload):
                        yield event_
                except Exception as e:
                    yield component_error_event(
                        trace_id=event.payload.trace_id,
                        node_id=event.payload.node_id,
                        error=repr(e),
                    )
            case _:
                yield Error(
                    payload=ErrorPayload(
                        message=f"Unknown event type from client: {event.type}"
                    )
                )

    except Exception as e:
        yield Error(payload=ErrorPayload(message=repr(e)))

    yield Done()


def component_error_event(trace_id: str, node_id: str, error: str):
    return ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=node_id,
            execution_state=ExecutionState(
                status=ComponentExecutionStatus.error,
                error=error,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
            ),
        )
    )


def event_worker(
    ready_event: Event,
    queue_in: "Queue[StudioClientEvent | None]",
    queue_out: "Queue[StudioServerEvent]",
):
    ready_event.set()
    while True:
        try:
            event = queue_in.get(timeout=1)
            if event is None:  # Sentinel to exit
                break
            try:

                async def async_execute_event(event):
                    async for event_ in execute_event(event):
                        queue_out.put(event_)

                asyncio.run(async_execute_event(event))
            except Exception as e:
                queue_out.put(Error(payload=ErrorPayload(message=repr(e))))
        except queue.Empty:
            continue


class RunningProcess(TypedDict):
    process: Process
    queue: "Queue[StudioServerEvent]"


running_processes: Dict[str, RunningProcess] = {}


# We execute events on a subprocess because each user might execute completely different code,
# which can alter the global Python interpreter state in unpredictable ways. DSPy itself does
# a lot of this. At same time, we want to fork the main process to avoid double RAM spending and
# startup times.
async def execute_event_on_a_subprocess(event: StudioClientEvent):
    if isinstance(event, StopExecution):
        if event.payload.trace_id in running_processes:
            queue = running_processes[event.payload.trace_id]["queue"]
            queue.put(Done())

            await asyncio.sleep(0.2)

            # Check again because the process generally finishes gracefully on its own
            if event.payload.trace_id in running_processes:
                process = running_processes[event.payload.trace_id]["process"]
                process.kill()
                process.join()
                del running_processes[event.payload.trace_id]
            if event.payload.node_id:
                yield component_error_event(
                    trace_id=event.payload.trace_id,
                    node_id=event.payload.node_id,
                    error="Interrupted",
                )
            else:
                yield Error(payload=ErrorPayload(message="Interrupted"))
        return

    process, queue = pool.submit(event)

    if (
        hasattr(event.payload, "trace_id")
        and event.payload.trace_id not in running_processes  # type: ignore
    ):
        running_processes[event.payload.trace_id] = RunningProcess(  # type: ignore
            process=process, queue=queue
        )

    timeout_without_messages = 120  # seconds

    try:
        done = False
        last_message_time = time.time()
        time_since_last_message = 0
        while time_since_last_message < timeout_without_messages:
            time_since_last_message = time.time() - last_message_time
            try:
                result = queue.get(timeout=0.1)
                yield result
                last_message_time = time.time()

                if isinstance(result, Done):
                    done = True
                    break
            except Empty:
                if timeout_without_messages > 10 and not process.is_alive():
                    raise Exception("Runtime crashed")

                await asyncio.sleep(0.1)

        if not done:
            # Timeout occurred
            yield Error(payload=ErrorPayload(message="Execution timed out"))
            process.terminate()
            process.join(timeout=5)  # Give it 5 seconds to terminate gracefully
            if process.is_alive():
                # Force kill if it doesn't terminate
                process.kill()
                process.join()

    except Exception as e:
        yield Error(payload=ErrorPayload(message=f"Unexpected error: {repr(e)}"))
    finally:
        # Ensure the process is terminated and resources are cleaned up
        if process.is_alive():
            process.terminate()
            process.join()

        if (
            hasattr(event.payload, "trace_id")
            and event.payload.trace_id in running_processes  # type: ignore
        ):
            del running_processes[event.payload.trace_id]  # type: ignore


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
