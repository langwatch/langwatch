from enum import Enum


class PostApiGatewayV1VirtualKeysByIdRevokeResponse200VirtualKeyPurpose(str, Enum):
    LANGY = "langy"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
