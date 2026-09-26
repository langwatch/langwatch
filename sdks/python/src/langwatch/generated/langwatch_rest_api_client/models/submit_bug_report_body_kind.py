from enum import Enum


class SubmitBugReportBodyKind(str, Enum):
    FULL_SESSION = "full_session"
    SUMMARY = "summary"

    def __str__(self) -> str:
        return str(self.value)
