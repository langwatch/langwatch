from enum import Enum


class DeleteApiGatewayV1ProvidersByIdResponse410Fault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
