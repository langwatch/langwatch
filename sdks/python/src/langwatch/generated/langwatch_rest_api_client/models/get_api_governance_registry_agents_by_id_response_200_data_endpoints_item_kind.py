from enum import Enum


class GetApiGovernanceRegistryAgentsByIdResponse200DataEndpointsItemKind(str, Enum):
    CONSOLE = "console"
    DEFINITION = "definition"
    INVOKE = "invoke"

    def __str__(self) -> str:
        return str(self.value)
