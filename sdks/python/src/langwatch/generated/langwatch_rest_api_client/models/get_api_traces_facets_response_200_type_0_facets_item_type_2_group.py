from enum import Enum


class GetApiTracesFacetsResponse200Type0FacetsItemType2Group(str, Enum):
    EVALUATION = "evaluation"
    METADATA = "metadata"
    PROMPT = "prompt"
    SPAN = "span"
    TRACE = "trace"

    def __str__(self) -> str:
        return str(self.value)
