from enum import Enum


class GetApiGatewayV1VirtualKeysResponse200DataItemPurpose(str, Enum):
    LANGY = "langy"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
