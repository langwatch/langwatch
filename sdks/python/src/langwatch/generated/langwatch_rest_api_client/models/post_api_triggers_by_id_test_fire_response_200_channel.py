from enum import Enum


class PostApiTriggersByIdTestFireResponse200Channel(str, Enum):
    EMAIL = "email"
    SLACK = "slack"
    WEBHOOK = "webhook"

    def __str__(self) -> str:
        return str(self.value)
