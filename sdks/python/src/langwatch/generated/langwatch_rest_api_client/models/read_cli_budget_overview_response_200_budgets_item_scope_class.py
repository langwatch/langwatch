from enum import Enum


class ReadCliBudgetOverviewResponse200BudgetsItemScopeClass(str, Enum):
    DEPARTMENT = "department"
    KEY = "key"
    ORGANIZATION = "organization"
    OTHER = "other"
    PERSONAL = "personal"
    PROJECT = "project"
    TEAM = "team"

    def __str__(self) -> str:
        return str(self.value)
