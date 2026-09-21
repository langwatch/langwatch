from enum import Enum


class GetApiGatewayV1VirtualKeysByIdResponse200VirtualKeyPurpose(str, Enum):
    LANGY = "langy"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
