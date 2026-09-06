from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemPred")


@_attrs_define
class PostApiDspyLogStepsBodyItemExamplesItemTraceType0ItemPred:
    """
    Attributes:
        field_class_ (str | Unset):
    """

    field_class_: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field_class_ = self.field_class_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if field_class_ is not UNSET:
            field_dict["__class__"] = field_class_

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field_class_ = d.pop("__class__", UNSET)

        post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item_pred = cls(
            field_class_=field_class_,
        )

        post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item_pred.additional_properties = d
        return post_api_dspy_log_steps_body_item_examples_item_trace_type_0_item_pred

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
