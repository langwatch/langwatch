from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="LangyLocalStartWaitBodyQuestionsItemOptionsItem")


@_attrs_define
class LangyLocalStartWaitBodyQuestionsItemOptionsItem:
    """
    Attributes:
        label (str):
        description (str | Unset):
        quiet (bool | Unset):
    """

    label: str
    description: str | Unset = UNSET
    quiet: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        description = self.description

        quiet = self.quiet

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "label": label,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if quiet is not UNSET:
            field_dict["quiet"] = quiet

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        label = d.pop("label")

        description = d.pop("description", UNSET)

        quiet = d.pop("quiet", UNSET)

        langy_local_start_wait_body_questions_item_options_item = cls(
            label=label,
            description=description,
            quiet=quiet,
        )

        langy_local_start_wait_body_questions_item_options_item.additional_properties = d
        return langy_local_start_wait_body_questions_item_options_item

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
