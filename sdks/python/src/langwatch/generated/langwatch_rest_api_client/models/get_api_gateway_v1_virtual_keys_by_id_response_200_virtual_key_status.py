from enum import Enum


class GetApiGatewayV1VirtualKeysByIdResponse200VirtualKeyStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    REVOKED = "revoked"

    def __str__(self) -> str:
        return str(self.value)
