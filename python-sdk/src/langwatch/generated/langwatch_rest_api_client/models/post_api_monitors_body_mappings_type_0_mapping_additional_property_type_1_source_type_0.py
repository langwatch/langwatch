from enum import Enum


class PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1SourceType0(str, Enum):
    FORMATTED_TRACES = "formatted_traces"
    THREAD_ID = "thread_id"
    TRACES = "traces"

    def __str__(self) -> str:
        return str(self.value)
