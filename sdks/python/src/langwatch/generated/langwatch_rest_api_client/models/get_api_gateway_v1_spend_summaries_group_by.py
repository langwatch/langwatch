from enum import Enum


class GetApiGatewayV1SpendSummariesGroupBy(str, Enum):
    END_USER = "end_user"
    VIRTUAL_KEY = "virtual_key"

    def __str__(self) -> str:
        return str(self.value)
