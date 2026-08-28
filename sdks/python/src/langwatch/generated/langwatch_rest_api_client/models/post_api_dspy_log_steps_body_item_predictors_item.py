from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_dspy_log_steps_body_item_predictors_item_predictor import (
        PostApiDspyLogStepsBodyItemPredictorsItemPredictor,
    )


T = TypeVar("T", bound="PostApiDspyLogStepsBodyItemPredictorsItem")


@_attrs_define
class PostApiDspyLogStepsBodyItemPredictorsItem:
    """
    Attributes:
        name (str):
        predictor (PostApiDspyLogStepsBodyItemPredictorsItemPredictor):
    """

    name: str
    predictor: PostApiDspyLogStepsBodyItemPredictorsItemPredictor

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        predictor = self.predictor.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "predictor": predictor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dspy_log_steps_body_item_predictors_item_predictor import (
            PostApiDspyLogStepsBodyItemPredictorsItemPredictor,
        )

        d = dict(src_dict)
        name = d.pop("name")

        predictor = PostApiDspyLogStepsBodyItemPredictorsItemPredictor.from_dict(d.pop("predictor"))

        post_api_dspy_log_steps_body_item_predictors_item = cls(
            name=name,
            predictor=predictor,
        )

        return post_api_dspy_log_steps_body_item_predictors_item
