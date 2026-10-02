from enum import Enum


class DeleteApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdResponse401Fault(str, Enum):
    CUSTOMER = "customer"
    PLATFORM = "platform"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
