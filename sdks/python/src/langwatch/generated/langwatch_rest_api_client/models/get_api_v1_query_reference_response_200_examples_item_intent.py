from enum import Enum


class GetApiV1QueryReferenceResponse200ExamplesItemIntent(str, Enum):
    CONVERSATIONS = "conversations"
    COST = "cost"
    DISCOVERY = "discovery"
    EXPORT = "export"
    LATENCY = "latency"
    QUALITY = "quality"
    TRIAGE = "triage"

    def __str__(self) -> str:
        return str(self.value)
