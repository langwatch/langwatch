from enum import Enum


class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemStopTrigger(str, Enum):
    API_KEY = "api_key"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
