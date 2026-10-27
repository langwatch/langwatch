from enum import Enum


class SubmitBugReportBodySource(str, Enum):
    CLI = "cli"
    MCP = "mcp"

    def __str__(self) -> str:
        return str(self.value)
