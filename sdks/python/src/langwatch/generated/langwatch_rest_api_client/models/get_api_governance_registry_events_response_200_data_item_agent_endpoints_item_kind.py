from enum import Enum


class GetApiGovernanceRegistryEventsResponse200DataItemAgentEndpointsItemKind(str, Enum):
    CONSOLE = "console"
    DEFINITION = "definition"
    INVOKE = "invoke"

    def __str__(self) -> str:
        return str(self.value)
