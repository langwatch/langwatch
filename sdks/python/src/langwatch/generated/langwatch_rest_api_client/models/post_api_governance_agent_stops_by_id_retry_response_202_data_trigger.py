from enum import Enum


class PostApiGovernanceAgentStopsByIdRetryResponse202DataTrigger(str, Enum):
    API_KEY = "api_key"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
