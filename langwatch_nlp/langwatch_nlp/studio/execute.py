import asyncio
import time
from typing import AsyncGenerator
from fastapi import FastAPI, Response, BackgroundTasks
from fastapi.responses import StreamingResponse
import json

from langwatch_nlp.studio.types.dsl import ComponentState, ExecutionState, Timestamps
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

    yield ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=event.node.id,
            execution_state=ExecutionState(
                state=ComponentState.running,
                trace_id=event.trace_id,
                timestamps=Timestamps(started_at=int(time.time() * 1000)),
            ),
        )
    )

    await asyncio.sleep(3)

    yield ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=event.node.id,
            execution_state=ExecutionState(
                state=ComponentState.success,
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
                                state=ComponentState.error,
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


async def event_encoder(event_generator: AsyncGenerator[StudioServerEvent, None]):
    async for event in event_generator:
        yield f"data: {json.dumps(event.model_dump())}\n\n"


@app.post("/execute")
async def execute(
    event: StudioClientEvent, response: Response, background_tasks: BackgroundTasks
):
    response.headers["Cache-Control"] = "no-cache"
    return StreamingResponse(
        event_encoder(execute_event(event)), media_type="text/event-stream"
    )
