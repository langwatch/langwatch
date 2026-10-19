from enum import Enum


class ExplainClickHouseQueryBodyType(str, Enum):
    AST = "AST"
    INDEXES = "INDEXES"
    PIPELINE = "PIPELINE"
    PLAN = "PLAN"
    SYNTAX = "SYNTAX"

    def __str__(self) -> str:
        return str(self.value)
