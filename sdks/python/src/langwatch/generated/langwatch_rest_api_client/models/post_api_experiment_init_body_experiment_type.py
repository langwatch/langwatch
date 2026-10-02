from enum import Enum


class PostApiExperimentInitBodyExperimentType(str, Enum):
    BATCH_EVALUATION = "BATCH_EVALUATION"
    BATCH_EVALUATION_V2 = "BATCH_EVALUATION_V2"
    DSPY = "DSPY"

    def __str__(self) -> str:
        return str(self.value)
