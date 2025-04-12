from typing import Any, Optional, TypeVar
import dspy


from langwatch_nlp.studio.runtimes.base_runtime import ServerEventQueue
from langwatch_nlp.studio.types.dsl import Workflow
from langwatch_nlp.studio.types.events import (
    component_error_event,
    end_component_event,
    start_component_event,
)
from pydantic import BaseModel

T = TypeVar("T", bound=dspy.Module)


class ReportingContext(BaseModel):
    queue: Any
    trace_id: str
    workflow: Workflow


class ReportingModule(dspy.Module):
    context: Optional[ReportingContext] = None

    def __init__(self):
        super().__init__()

    def set_reporting(
        self, *, queue: "ServerEventQueue", trace_id: str, workflow: Workflow
    ) -> None:
        self.context = ReportingContext(
            queue=queue, trace_id=trace_id, workflow=workflow
        )

    def forward(self, *args, **kwargs):
        raise NotImplementedError("This method should be implemented by the subclass")

    def with_reporting(self, module: T, node_id: str) -> T:
        # If already patched, repatch so new config can be picked up
        if hasattr(module, "__forward_before_reporting__"):
            module.forward = module.__forward_before_reporting__  # type: ignore
        module.__forward_before_reporting__ = module.forward  # type: ignore

        def forward_with_reporting(instance_self, *args, **kwargs):
            node = (
                next(node for node in self.context.workflow.nodes if node.id == node_id)
                if self.context
                else None
            )

            if self.context and node:
                self.context.queue.put_nowait(
                    start_component_event(node, self.context.trace_id, kwargs)
                )
            try:
                result = module.__forward_before_reporting__(instance_self, *args, **kwargs)  # type: ignore
            except Exception as e:
                import traceback

                traceback.print_exc()
                if self.context and node:
                    self.context.queue.put_nowait(
                        component_error_event(node.id, self.context.trace_id, repr(e))
                    )
                raise e
            if self.context and node:
                cost = result.cost if hasattr(result, "cost") else None
                self.context.queue.put_nowait(
                    end_component_event(node, self.context.trace_id, result, cost)
                )
            return result

        module.forward = forward_with_reporting  # type: ignore
        return module
