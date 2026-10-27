from enum import Enum


class PostApiTriggersBodyType1ActionParamsSlackDelivery(str, Enum):
    BOT = "bot"
    WEBHOOK = "webhook"

    def __str__(self) -> str:
        return str(self.value)
