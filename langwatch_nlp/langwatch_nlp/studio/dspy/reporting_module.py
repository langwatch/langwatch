from typing import Any, Optional
import dspy


from langwatch_nlp.studio.runtimes.base_runtime import ServerEventQueue
from langwatch_nlp.studio.types.dsl import Workflow
from langwatch_nlp.studio.types.events import (
    component_error_event,
    end_component_event,
    start_component_event,
)
from pydantic import BaseModel


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

    def with_reporting(self, module, node_id):
        node = (
            next(node for node in self.context.workflow.nodes if node.id == node_id)
            if self.context
            else None
        )

        def wrapper(*args, **kwargs):
            if self.context and node:
                self.context.queue.put_nowait(
                    start_component_event(node, self.context.trace_id, kwargs)
                )
            try:
                result = module(*args, **kwargs)
            except Exception as e:
                if self.context and node:
                    self.context.queue.put_nowait(
                        component_error_event(node.id, self.context.trace_id, repr(e))
                    )
                raise e
            if self.context and node:
                cost = result.cost if hasattr(result, "cost") else None
                self.context.queue.put_nowait(
                    end_component_event(node, self.context.trace_id, dict(result), cost)
                )
            return result

        return wrapper
