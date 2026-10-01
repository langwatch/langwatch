from enum import Enum


class PutApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacementResponse403ErrorFault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
