from enum import Enum


class PostApiCheckupRunResponse200RowsItemGroup(str, Enum):
    INSTALL = "install"
    INTEGRATIONS = "integrations"
    LANGWATCH = "langwatch"
    PIPELINES = "pipelines"

    def __str__(self) -> str:
        return str(self.value)
