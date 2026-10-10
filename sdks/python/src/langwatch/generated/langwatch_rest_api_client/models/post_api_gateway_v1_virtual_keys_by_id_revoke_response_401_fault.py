from enum import Enum


class PostApiGatewayV1VirtualKeysByIdRevokeResponse401Fault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PRESUMED_PLATFORM = "presumed_platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
