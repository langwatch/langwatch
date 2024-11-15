from typing import Any, Dict, List
import dspy

from langwatch_nlp.studio.dspy.predict_with_metadata import PredictWithMetadata


class LLMNode(dspy.Module):
    def __init__(
        self,
        node_id: str,
        predict: dspy.Module,
        lm: dspy.LM,
        demos: List[Dict[str, Any]],
    ):
        super().__init__()

        self.predict = predict

        nested_predict: dspy.Predict = (
            predict._predict if hasattr(predict, "_predict") else predict  # type: ignore
        )
        nested_predict.__class__ = PredictWithMetadata

        dspy.settings.configure(experimental=True)
        nested_predict.set_lm(lm=lm)
        nested_predict.demos = demos
        # LabeledFewShot patch
        nested_predict._node_id = node_id  # type: ignore

        def reset(self) -> None:
            PredictWithMetadata.reset(self)
            self.lm = lm

        nested_predict.reset = reset.__get__(nested_predict)

    def forward(self, **kwargs) -> Any:
        return self.predict(**kwargs)
