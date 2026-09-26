from enum import Enum


class PostApiGatewayV1VirtualKeysByIdDisableResponse400ErrorFault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
