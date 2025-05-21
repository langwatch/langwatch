from langwatch.evaluation.evaluation import Evaluation
from .evaluation import Evaluation


def init(name: str) -> Evaluation:
    evaluation = Evaluation(name)
    evaluation.init()
    return evaluation
