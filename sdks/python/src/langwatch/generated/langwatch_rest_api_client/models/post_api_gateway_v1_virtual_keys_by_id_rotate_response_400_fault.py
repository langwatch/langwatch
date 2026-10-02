from enum import Enum


class PostApiGatewayV1VirtualKeysByIdRotateResponse400Fault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
