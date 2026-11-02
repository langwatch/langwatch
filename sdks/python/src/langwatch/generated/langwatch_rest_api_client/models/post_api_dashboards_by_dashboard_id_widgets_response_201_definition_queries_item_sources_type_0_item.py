from enum import Enum


class PostApiDashboardsByDashboardIdWidgetsResponse201DefinitionQueriesItemSourcesType0Item(str, Enum):
    AI_TOOL = "ai_tool"
    APPLICATION = "application"
    CODING_AGENT = "coding_agent"
    EVALUATION = "evaluation"
    GATEWAY = "gateway"
    LANGY = "langy"
    OTHER = "other"
    PLAYGROUND = "playground"
    SAMPLE = "sample"
    SIMULATION = "simulation"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
