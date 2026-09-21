from enum import Enum


class PatchApiMonitorsByIdBodyMappingsType0ExpansionsItem(str, Enum):
    ANNOTATIONS_ID = "annotations.id"
    EVENTS_EVENT_ID = "events.event_id"
    SPANS_ALL_SPAN_ID = "spans.all.span_id"
    SPANS_LLM_SPAN_ID = "spans.llm.span_id"

    def __str__(self) -> str:
        return str(self.value)
