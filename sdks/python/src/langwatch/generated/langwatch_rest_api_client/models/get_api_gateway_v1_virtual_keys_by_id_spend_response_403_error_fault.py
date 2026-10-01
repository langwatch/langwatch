from enum import Enum


class GetApiGatewayV1VirtualKeysByIdSpendResponse403ErrorFault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
