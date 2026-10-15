from enum import Enum


class ReadCliBudgetOverviewResponse200Reason(str, Enum):
    FLAG_OFF = "flag_off"
    NO_MEMBERSHIP = "no_membership"

    def __str__(self) -> str:
        return str(self.value)
