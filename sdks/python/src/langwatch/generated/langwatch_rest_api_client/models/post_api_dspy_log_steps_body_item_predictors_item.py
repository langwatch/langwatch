from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        predictor = self.predictor.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_dspy_log_steps_body_item_predictors_item.additional_properties = d
        return post_api_dspy_log_steps_body_item_predictors_item

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
