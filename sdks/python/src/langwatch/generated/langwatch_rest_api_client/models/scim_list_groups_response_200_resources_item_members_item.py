from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimListGroupsResponse200ResourcesItemMembersItem")


@_attrs_define
class ScimListGroupsResponse200ResourcesItemMembersItem:
    """
    Attributes:
        value (str | Unset):
        display (str | Unset):
    """

    value: str | Unset = UNSET
    display: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        display = self.display

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if value is not UNSET:
            field_dict["value"] = value
        if display is not UNSET:
            field_dict["display"] = display

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        value = d.pop("value", UNSET)

        display = d.pop("display", UNSET)

        scim_list_groups_response_200_resources_item_members_item = cls(
            value=value,
            display=display,
        )

        scim_list_groups_response_200_resources_item_members_item.additional_properties = d
        return scim_list_groups_response_200_resources_item_members_item

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
