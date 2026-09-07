from enum import Enum


class PostApiGatewayV1VirtualKeysByIdDisableResponse200VirtualKeyStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    REVOKED = "revoked"

    def __str__(self) -> str:
        return str(self.value)
