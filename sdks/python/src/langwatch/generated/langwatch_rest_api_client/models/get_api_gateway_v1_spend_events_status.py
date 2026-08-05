from enum import Enum


class GetApiGatewayV1SpendEventsStatus(str, Enum):
    ADMITTED = "admitted"
    CONFIRMED = "confirmed"
    ERROR = "error"
    FAILED = "failed"
    SETTLED = "settled"
    SUCCESS = "success"

    def __str__(self) -> str:
        return str(self.value)
