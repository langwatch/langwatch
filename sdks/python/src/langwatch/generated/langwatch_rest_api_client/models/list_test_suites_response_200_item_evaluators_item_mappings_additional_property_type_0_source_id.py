from enum import Enum


class ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0SourceId(str, Enum):
    CONVERSATION = "conversation"
    SCENARIO = "scenario"
    TRACE = "trace"

    def __str__(self) -> str:
        return str(self.value)
