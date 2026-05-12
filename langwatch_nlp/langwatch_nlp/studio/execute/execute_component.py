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

    if node.type in ("entry", "end"):
        raise ValueError(
            f"{node.type.capitalize()} nodes cannot be executed as standalone components"
        )

    disable_dsp_caching()

    started_at = int(time.time() * 1000)
    yield start_component_event(node, event.trace_id)

    do_not_trace = not event.workflow.enable_tracing

    try:
        origin = event.origin or "workflow"
        metadata={}
        if event.thread_id:
            metadata["thread_id"] = event.thread_id

        with optional_langwatch_trace(
            name="execute_component",
            type="component",
            do_not_trace=do_not_trace,
            metadata=metadata if metadata else {},
            origin=origin,
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
                    # PR #3543 back-compat: the parser accepts plain classes
                    # with `forward(...)` only (no __call__ and no dspy.Module
                    # base). Such classes aren't directly callable —
                    # `dspy.asyncify(instance)(...)` would TypeError. Fall back
                    # to `instance.forward` when `instance` isn't callable;
                    # mirrors the priority-3 path in the Go runner
                    # (services/nlpgo/.../codeblock/runner.py). dspy.Module
                    # subclasses always have __call__ so they hit the fast
                    # path unchanged.
                    #
                    # `callable(invoke_target)` covers both legs of the failure
                    # surface: missing-attribute (`getattr` default = None,
                    # `callable(None)` is False) AND non-callable-attribute
                    # (e.g. a string class attribute named `forward`). Either
                    # case raises a typed error here so the operator sees a
                    # message naming the class instead of asyncify's
                    # less-informative 'object is not callable'.
                    invoke_target = instance if callable(instance) else getattr(instance, "forward", None)
                    if not callable(invoke_target):
                        raise TypeError(
                            f"Class '{class_name}' for component {node.data.name} "
                            f"has no callable entrypoint. Define __call__(self, ...) "
                            f"or forward(self, ...) on the class."
                        )
                    result = await dspy.asyncify(invoke_target)(
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
