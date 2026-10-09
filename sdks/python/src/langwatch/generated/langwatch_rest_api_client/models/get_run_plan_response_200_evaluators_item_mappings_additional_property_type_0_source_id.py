from enum import Enum


class GetRunPlanResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId(str, Enum):
    CONVERSATION = "conversation"
    SCENARIO = "scenario"
    TRACE = "trace"

    def __str__(self) -> str:
        return str(self.value)
