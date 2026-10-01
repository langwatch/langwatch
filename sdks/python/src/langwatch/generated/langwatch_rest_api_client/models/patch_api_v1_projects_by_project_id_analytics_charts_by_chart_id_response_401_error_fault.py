from enum import Enum


class PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdResponse401ErrorFault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
