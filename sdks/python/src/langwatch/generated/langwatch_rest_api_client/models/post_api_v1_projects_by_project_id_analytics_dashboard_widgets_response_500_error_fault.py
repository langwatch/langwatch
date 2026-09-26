from enum import Enum


class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsResponse500ErrorFault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
