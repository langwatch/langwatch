from enum import Enum


class GetApiV1ProjectsByProjectIdAnalyticsChartsResponse403Fault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
