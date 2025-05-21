from langwatch.evaluation.evaluation import Evaluation
from .evaluation import Evaluation


def init(name: str) -> Evaluation:
    return Evaluation(name)
