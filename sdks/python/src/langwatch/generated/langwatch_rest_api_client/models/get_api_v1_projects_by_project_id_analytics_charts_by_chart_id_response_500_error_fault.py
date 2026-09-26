from enum import Enum


class GetApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse500ErrorFault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
