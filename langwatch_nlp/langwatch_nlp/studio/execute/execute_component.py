import time
import dspy
import sentry_sdk
from langwatch_nlp.studio.dspy import TemplateAdapter
from langwatch_nlp.studio.field_parser import autoparse_fields
from langwatch_nlp.studio.parser import (
    materialized_component_class,
    normalized_node,
    parse_component,
)
from langwatch_nlp.studio.utils import build_secrets_preamble, disable_dsp_caching, optional_langwatch_trace
from langwatch_nlp.studio.types.events import (
    Debug,
    DebugPayload,
    ExecuteComponentPayload,
    end_component_event,
    start_component_event,
)


async def execute_component(event: ExecuteComponentPayload):
    yield Debug(payload=DebugPayload(message="executing component"))

    node = [node for node in event.workflow.nodes if node.id == event.node_id][0]
    disable_dsp_caching()

    started_at = int(time.time() * 1000)
    yield start_component_event(node, event.trace_id)

    do_not_trace = not event.workflow.enable_tracing

    try:
        metadata={
            "platform": "optimization_studio",
            "environment": "development",
        }
        if event.thread_id:
            metadata["thread_id"] = event.thread_id

        with optional_langwatch_trace(
            name="execute_component",
            type="component",
            do_not_trace=do_not_trace,
            metadata=metadata,
        ) as trace:
            if trace:
                trace.autotrack_dspy()
            code, class_name, kwargs = parse_component(
                normalized_node(node), event.workflow, standalone=True
            )
            code = build_secrets_preamble(event.workflow.secrets) + code
            with dspy.context(**({"adapter": TemplateAdapter()} if event.workflow.template_adapter == "default" else {})):
                with materialized_component_class(
                    component_code=code, class_name=class_name
                ) as Module:
                    instance = Module(**kwargs)
                    # HTTP nodes need all inputs for template interpolation, bypass autoparse
                    # which would filter to only defined fields and stringify arrays.
                    # Agent nodes with HTTP sub-type also need this bypass.
                    agent_type_param = next(
                        (f.value for f in (node.data.parameters or []) if f.identifier == "agent_type"),
                        None,
                    )
                    if node.type == "http" or (node.type == "agent" and agent_type_param == "http"):
                        forward_inputs = event.inputs
                    else:
                        forward_inputs = autoparse_fields(node.data.inputs or [], event.inputs)  # type: ignore
                    result = await dspy.asyncify(instance)(
                        **forward_inputs
                    )

        cost = result.cost if hasattr(result, "cost") else None

        yield end_component_event(node, event.trace_id, result, cost, started_at=started_at)
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
