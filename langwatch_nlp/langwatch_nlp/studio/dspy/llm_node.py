from typing import Any, Dict, List, Optional
import dspy
import langwatch

from langwatch_nlp.studio.dspy.predict_with_metadata import PredictWithMetadata
from langwatch_nlp.studio.field_parser import with_autoparsing


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
            predict._predict if hasattr(predict, "_predict") else predict  # type: ignore
        )

        signature = (
            nested_predict.signature if hasattr(nested_predict, "signature") else None
        )

        # Create a new PredictWithMetadata instance with the signature
        if signature:
            self.predict = PredictWithMetadata(signature)
            # Transfer LM and other attributes
            if hasattr(nested_predict, "lm"):
                self.predict.lm = nested_predict.lm
            if hasattr(nested_predict, "demos"):
                self.predict.demos = nested_predict.demos
            if hasattr(nested_predict, "_node_id"):
                self.predict._node_id = getattr(nested_predict, "_node_id", None)
        else:
            # If no signature found, use the original predict
            self.predict = predict

        # Set LM if provided
        if lm is not None:
            self.predict.set_lm(lm=lm)
        # Set demos
        setattr(self.predict, "demos", demos)
        # LabeledFewShot patch
        self.predict._node_id = node_id  # type: ignore

    def forward(self, **kwargs) -> Any:
        try:
            langwatch.get_current_span().update(name=f"{self._name}.forward")
        except:
            pass

        return self.predict(**kwargs)
