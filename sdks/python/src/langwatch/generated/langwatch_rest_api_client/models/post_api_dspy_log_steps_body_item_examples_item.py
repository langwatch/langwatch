from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dspy_log_steps_body_item_examples_item_example import (
        PostApiDspyLogStepsBodyItemExamplesItemExample,
    )
    from ..models.post_api_dspy_log_steps_body_item_examples_item_pred import (
        PostApiDspyLogStepsBodyItemExamplesItemPred,
    )
    from ..models.post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item import (
        PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item,
    )


T = TypeVar("T", bound="PostApiDspyLogStepsBodyItemExamplesItem")


@_attrs_define
class PostApiDspyLogStepsBodyItemExamplesItem:
    """
    Attributes:
        example (PostApiDspyLogStepsBodyItemExamplesItemExample):
        pred (PostApiDspyLogStepsBodyItemExamplesItemPred):
        score (float):
        trace (list[PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item] | None | Unset):
    """

    example: PostApiDspyLogStepsBodyItemExamplesItemExample
    pred: PostApiDspyLogStepsBodyItemExamplesItemPred
    score: float
    trace: list[PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item] | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        example = self.example.to_dict()

        pred = self.pred.to_dict()

        score = self.score

        trace: list[dict[str, Any]] | None | Unset
        if isinstance(self.trace, Unset):
            trace = UNSET
        elif isinstance(self.trace, list):
            trace = []
            for trace_type_0_item_data in self.trace:
                trace_type_0_item = trace_type_0_item_data.to_dict()
                trace.append(trace_type_0_item)

        else:
            trace = self.trace

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "example": example,
                "pred": pred,
                "score": score,
            }
        )
        if trace is not UNSET:
            field_dict["trace"] = trace

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dspy_log_steps_body_item_examples_item_example import (
            PostApiDspyLogStepsBodyItemExamplesItemExample,
        )
        from ..models.post_api_dspy_log_steps_body_item_examples_item_pred import (
            PostApiDspyLogStepsBodyItemExamplesItemPred,
        )
        from ..models.post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item import (
            PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item,
        )

        d = dict(src_dict)
        example = PostApiDspyLogStepsBodyItemExamplesItemExample.from_dict(d.pop("example"))

        pred = PostApiDspyLogStepsBodyItemExamplesItemPred.from_dict(d.pop("pred"))

        score = d.pop("score")

        def _parse_trace(data: object) -> list[PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                trace_type_0 = []
                _trace_type_0 = data
                for trace_type_0_item_data in _trace_type_0:
                    trace_type_0_item = PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item.from_dict(
                        trace_type_0_item_data
                    )

                    trace_type_0.append(trace_type_0_item)

                return trace_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item] | None | Unset, data)

        trace = _parse_trace(d.pop("trace", UNSET))

        post_api_dspy_log_steps_body_item_examples_item = cls(
            example=example,
            pred=pred,
            score=score,
            trace=trace,
        )

        return post_api_dspy_log_steps_body_item_examples_item
