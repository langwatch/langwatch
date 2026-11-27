from enum import Enum


class GetApiGovernanceAgentStopsResponse200DataItemTrigger(str, Enum):
    API_KEY = "api_key"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
