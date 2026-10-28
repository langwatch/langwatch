from enum import Enum


class PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodyQueriesItemSourcesType0Item(str, Enum):
    APPLICATION = "application"
    CODING_AGENT = "coding_agent"
    EVALUATION = "evaluation"
    GATEWAY = "gateway"
    LANGY = "langy"
    OTHER = "other"
    PLAYGROUND = "playground"
    SIMULATION = "simulation"
    WORKFLOW = "workflow"

    def __str__(self) -> str:
        return str(self.value)
