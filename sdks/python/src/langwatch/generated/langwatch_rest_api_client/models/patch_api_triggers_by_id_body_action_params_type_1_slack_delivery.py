from enum import Enum


class PatchApiTriggersByIdBodyActionParamsType1SlackDelivery(str, Enum):
    BOT = "bot"
    WEBHOOK = "webhook"

    def __str__(self) -> str:
        return str(self.value)
