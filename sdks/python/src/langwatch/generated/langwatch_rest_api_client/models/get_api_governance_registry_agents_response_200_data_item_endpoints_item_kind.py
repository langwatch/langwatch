from enum import Enum


class GetApiGovernanceRegistryAgentsResponse200DataItemEndpointsItemKind(str, Enum):
    CONSOLE = "console"
    DEFINITION = "definition"
    INVOKE = "invoke"

    def __str__(self) -> str:
        return str(self.value)
