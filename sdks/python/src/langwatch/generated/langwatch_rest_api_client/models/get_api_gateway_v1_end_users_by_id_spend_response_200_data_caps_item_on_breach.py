from enum import Enum


class GetApiGatewayV1EndUsersByIdSpendResponse200DataCapsItemOnBreach(str, Enum):
    BLOCK = "block"
    WARN = "warn"

    def __str__(self) -> str:
        return str(self.value)
