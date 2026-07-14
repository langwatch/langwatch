from enum import Enum


class PostApiScenarioEventsBodyType1ResultsType0Verdict(str, Enum):
    FAILURE = "failure"
    INCONCLUSIVE = "inconclusive"
    SUCCESS = "success"

    def __str__(self) -> str:
        return str(self.value)
