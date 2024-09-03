import asyncio
from multiprocessing import Process, Queue
from queue import Empty
import time
from typing import AsyncGenerator, Dict
from fastapi import FastAPI, Response, BackgroundTasks
from fastapi.responses import StreamingResponse
import json

from langwatch_nlp.studio.types.dsl import (
    ComponentExecutionStatus,
    ExecutionState,
    Timestamps,
)
from .types.events import (
    ComponentStateChange,
    ComponentStateChangePayload,
    Debug,
    DebugPayload,
    Done,
    ExecuteComponentPayload,
    StudioClientEvent,
    StudioServerEvent,
    Error,
    ErrorPayload,
)

app = FastAPI()


async def execute_component(event: ExecuteComponentPayload):
    yield Debug(payload=DebugPayload(message="executing component"))

    started_at = int(time.time() * 1000)

    yield ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=event.node.id,
            execution_state=ExecutionState(
                status=ComponentExecutionStatus.running,
                trace_id=event.trace_id,
                timestamps=Timestamps(started_at=started_at),
            ),
        )
    )

    await asyncio.sleep(3)

    yield ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=event.node.id,
            execution_state=ExecutionState(
                status=ComponentExecutionStatus.success,
                trace_id=event.trace_id,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
                outputs={
                    output.identifier: "barbaz"
                    for output in event.node.data.outputs or []
                },
            ),
        )
    )


async def execute_event(
    event: StudioClientEvent,
) -> AsyncGenerator[StudioServerEvent, None]:
    yield Debug(payload=DebugPayload(message="server starting execution"))

    try:
        match event.type:
            case "execute_component":
                try:
                    async for event_ in execute_component(event.payload):
                        yield event_
                except Exception as e:
                    yield ComponentStateChange(
                        payload=ComponentStateChangePayload(
                            component_id=event.payload.node.id,
                            execution_state=ExecutionState(
                                status=ComponentExecutionStatus.error,
                                trace_id=event.payload.trace_id,
                                error=repr(e),
                            ),
                        )
                    )
            case _:
                yield Error(payload=ErrorPayload(message="unknown event type"))

    except Exception as e:
        yield Error(payload=ErrorPayload(message=repr(e)))

    yield Done()


def execute_event_to_queue(event: StudioClientEvent, queue: "Queue[StudioServerEvent]"):
    async def async_execute_event():
        async for event_ in execute_event(event):
            queue.put(event_)

    asyncio.run(async_execute_event())


running_processes: Dict[str, Process] = {}


# We execute events on a subprocess because each user might execute completely different code,
# which can alter the global Python interpreter state in unpredictable ways. DSPy itself does
# a lot of this. At same time, we want to fork the main process to avoid double RAM spending and
# startup times.
async def execute_event_on_a_subprocess(event: StudioClientEvent):
    queue: "Queue[StudioServerEvent]" = Queue()

    # ctx = multiprocessing.get_context("spawn")
    process = Process(target=execute_event_to_queue, args=(event, queue))
    # process = spawn_process.
    process.start()
    if (
        hasattr(event.payload, "trace_id")
        and event.payload.trace_id not in running_processes
    ):
        running_processes[event.payload.trace_id] = process

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
            and event.payload.trace_id in running_processes
        ):
            del running_processes[event.payload.trace_id]


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
