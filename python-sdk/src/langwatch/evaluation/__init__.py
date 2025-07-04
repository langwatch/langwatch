from typing import Optional
from langwatch.evaluation.evaluation import Evaluation
from .evaluation import Evaluation


def init(name: str, *, run_id: Optional[str] = None) -> Evaluation:
    evaluation = Evaluation(name, run_id=run_id)
    evaluation.init()
    return evaluation
