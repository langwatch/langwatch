from enum import Enum


class GetApiGatewayV1SpendSummariesStatus(str, Enum):
    CONFIRMED = "confirmed"
    ERROR = "error"
    FAILED = "failed"
    SETTLED = "settled"
    SUCCESS = "success"

    def __str__(self) -> str:
        return str(self.value)
