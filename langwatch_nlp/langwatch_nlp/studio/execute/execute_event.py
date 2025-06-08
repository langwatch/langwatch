import traceback
from typing import AsyncGenerator, Union


from langwatch_nlp.studio.runtimes.base_runtime import ServerEventQueue
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
import langwatch


async def execute_event(
    event: StudioClientEvent,
    queue: "ServerEventQueue",
) -> AsyncGenerator[StudioServerEvent, None]:
    yield Debug(payload=DebugPayload(message="server starting execution"))

    try:
        match event.type:
            case "is_alive":
                yield IsAliveResponse()
            case "execute_component":
                if event.payload.workflow.enable_tracing:
                    langwatch.setup(api_key=event.payload.workflow.api_key)
                try:
                    async for event_ in execute_component(event.payload):
                        yield event_
                except Exception as e:
                    import traceback

                    traceback.print_exc()
                    yield component_error_event(
                        trace_id=event.payload.trace_id,
                        node_id=event.payload.node_id,
                        error=_error_repr(e),
                    )
            case "execute_flow":
                if event.payload.workflow.enable_tracing:
                    langwatch.setup(api_key=event.payload.workflow.api_key)
                try:
                    async for event_ in execute_flow(event.payload, queue):
                        yield event_
                except Exception as e:
                    import traceback

                    traceback.print_exc()
                    yield Error(payload=ErrorPayload(message=_error_repr(e)))
            case "execute_evaluation":
                if event.payload.workflow.enable_tracing:
                    langwatch.setup(api_key=event.payload.workflow.api_key)
                try:
                    async for event_ in execute_evaluation(event.payload, queue):
                        yield event_
                except Exception as e:
                    yield Error(payload=ErrorPayload(message=_error_repr(e)))
            case "execute_optimization":
                if event.payload.workflow.enable_tracing:
                    langwatch.setup(api_key=event.payload.workflow.api_key)
                try:
                    async for event_ in execute_optimization(event.payload, queue):
                        yield event_
                except Exception as e:
                    yield Error(payload=ErrorPayload(message=_error_repr(e)))
            case _:
                yield Error(
                    payload=ErrorPayload(
                        message=f"Unknown event type from client: {event.type}"
                    )
                )

    except Exception as e:
        import traceback

        traceback.print_exc()
        yield Error(payload=ErrorPayload(message=repr(e)))

    yield Done()


def _error_repr(e: Exception) -> str:
    if isinstance(e, ValueError):
        return str(e)
    else:
        return repr(e)
