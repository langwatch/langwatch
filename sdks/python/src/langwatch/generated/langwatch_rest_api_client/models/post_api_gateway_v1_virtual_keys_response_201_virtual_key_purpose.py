from enum import Enum


class PostApiGatewayV1VirtualKeysResponse201VirtualKeyPurpose(str, Enum):
    LANGY = "langy"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
