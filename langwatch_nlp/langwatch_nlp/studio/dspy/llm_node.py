from typing import Any, Dict, List, Optional
import dspy
import langwatch

from langwatch_nlp.studio.dspy.predict_with_metadata import PredictWithMetadata


class LLMNode(dspy.Module):
    def __init__(
        self,
        node_id: str,
        name: str,
        predict: dspy.Module,
        lm: Optional[dspy.LM] = None,
        demos: List[Dict[str, Any]] = [],
    ):
        super().__init__()

        self.predict = predict
        self._name = name

        nested_predict: dspy.Predict = (
            predict.predict if hasattr(predict, "predict") else predict  # type: ignore
        )
        nested_predict.__class__ = PredictWithMetadata

        if lm is not None:
            nested_predict.set_lm(lm=lm)
        nested_predict.demos = demos
        # LabeledFewShot patch
        nested_predict._node_id = node_id  # type: ignore

    def forward(self, **kwargs) -> Any:
        try:
            langwatch.get_current_span().update(name=f"{self._name}.forward")
        except:
            pass

        return self.predict(**kwargs)
