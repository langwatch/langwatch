from enum import Enum


class GetApiGatewayV1VirtualKeysResponse200DataItemStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    REVOKED = "revoked"

    def __str__(self) -> str:
        return str(self.value)
