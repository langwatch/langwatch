from multiprocessing import Queue
import traceback
from typing import AsyncGenerator


from langwatch_nlp.studio.execute.execute_component import execute_component
from langwatch_nlp.studio.execute.execute_evaluation import (
    execute_evaluation,
)
from langwatch_nlp.studio.execute.execute_flow import execute_flow
from langwatch_nlp.studio.execute.execute_optimization import (
    execute_optimization,
)
from langwatch_nlp.studio.types.events import (
    Debug,
    DebugPayload,
    Done,
    IsAliveResponse,
    StudioClientEvent,
    StudioServerEvent,
    Error,
    ErrorPayload,
    component_error_event,
)


async def execute_event(
    event: StudioClientEvent,
    queue: "Queue[StudioServerEvent]",
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
            case "execute_flow":
                try:
                    async for event_ in execute_flow(event.payload, queue):
                        yield event_
                except Exception as e:
                    traceback.print_exc()
                    yield Error(payload=ErrorPayload(message=repr(e)))
            case "execute_evaluation":
                try:
                    async for event_ in execute_evaluation(event.payload, queue):
                        yield event_
                except Exception as e:
                    yield Error(payload=ErrorPayload(message=repr(e)))
            case "execute_optimization":
                try:
                    async for event_ in execute_optimization(event.payload, queue):
                        yield event_
                except Exception as e:
                    yield Error(payload=ErrorPayload(message=repr(e)))
            case _:
                yield Error(
                    payload=ErrorPayload(
                        message=f"Unknown event type from client: {event.type}"
                    )
                )

    except Exception as e:
        yield Error(payload=ErrorPayload(message=repr(e)))

    yield Done()
