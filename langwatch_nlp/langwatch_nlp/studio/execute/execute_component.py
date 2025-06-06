import dspy
import asyncer
import sentry_sdk
from langwatch_nlp.studio.field_parser import autoparse_fields
from langwatch_nlp.studio.parser import (
    materialized_component_class,
    normalized_node,
    parse_component,
)
from langwatch_nlp.studio.utils import disable_dsp_caching, optional_langwatch_trace
from langwatch_nlp.studio.types.events import (
    Debug,
    DebugPayload,
    ExecuteComponentPayload,
    end_component_event,
    start_component_event,
)
import langwatch


async def execute_component(event: ExecuteComponentPayload):
    yield Debug(payload=DebugPayload(message="executing component"))

    node = [node for node in event.workflow.nodes if node.id == event.node_id][0]
    disable_dsp_caching()

    yield start_component_event(node, event.trace_id)

    do_not_trace = not event.workflow.enable_tracing

    langwatch.setup(api_key=event.workflow.api_key)

    try:
        with optional_langwatch_trace(
            do_not_trace=do_not_trace,
            trace_id=event.trace_id,
            skip_root_span=True,
            metadata={
                "platform": "optimization_studio",
                "environment": "development",
            },
        ) as trace:
            if trace:
                trace.autotrack_dspy()
            code, class_name, kwargs = parse_component(
                normalized_node(node), event.workflow, standalone=True
            )
            with materialized_component_class(
                component_code=code, class_name=class_name
            ) as Module:
                instance = Module(**kwargs)
                result = await dspy.asyncify(instance)(
                    **autoparse_fields(node.data.inputs or [], event.inputs)  # type: ignore
                )

        cost = result.cost if hasattr(result, "cost") else None

        yield end_component_event(node, event.trace_id, result, cost)
    except Exception as e:
        import traceback

        traceback.print_exc()
        sentry_sdk.capture_exception(
            e,
            extras={
                "trace_id": event.trace_id,
                "workflow_id": event.workflow.workflow_id,
            },
        )
        raise e
    finally:
        if trace:
            await asyncer.asyncify(trace.send_spans)()
