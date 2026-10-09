from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item_input import (
        PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemInput,
    )
    from ..models.post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item_pred import (
        PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemPred,
    )


T = TypeVar("T", bound="PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item")


@_attrs_define
class PostApiDspyLogStepsBodyItemExamplesItemTraceType0Item:
    """
    Attributes:
        input_ (PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemInput):
        pred (PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemPred):
    """

    input_: PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemInput
    pred: PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemPred

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_.to_dict()

        pred = self.pred.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "input": input_,
                "pred": pred,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item_input import (
            PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemInput,
        )
        from ..models.post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item_pred import (
            PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemPred,
        )

        d = dict(src_dict)
        input_ = PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemInput.from_dict(d.pop("input"))

        pred = PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemPred.from_dict(d.pop("pred"))

        post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item = cls(
            input_=input_,
            pred=pred,
        )

        return post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item
