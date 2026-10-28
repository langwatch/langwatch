from enum import Enum


class GetApiDashboardsByDashboardIdWidgetsResponse200DataItemDefinitionQueriesItemSourcesType0Item(str, Enum):
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
