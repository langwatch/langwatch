from enum import Enum


class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboardResponse400Fault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PRESUMED_PLATFORM = "presumed_platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
