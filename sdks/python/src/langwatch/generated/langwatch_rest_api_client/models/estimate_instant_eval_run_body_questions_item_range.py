from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="EstimateInstantEvalRunBodyQuestionsItemRange")


@_attrs_define
class EstimateInstantEvalRunBodyQuestionsItemRange:
    """For a rating: the two ends of the scale.

    Attributes:
        min_ (int): The lowest level of the scale.
        max_ (int): The highest level of the scale.
    """

    min_: int
    max_: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        min_ = self.min_

        max_ = self.max_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "min": min_,
                "max": max_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        min_ = d.pop("min")

        max_ = d.pop("max")

        estimate_instant_eval_run_body_questions_item_range = cls(
            min_=min_,
            max_=max_,
        )

        estimate_instant_eval_run_body_questions_item_range.additional_properties = d
        return estimate_instant_eval_run_body_questions_item_range

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
