from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimReplaceGroupResponse200MembersItem")


@_attrs_define
class ScimReplaceGroupResponse200MembersItem:
    """
    Attributes:
        value (str):
        display (str | Unset):
    """

    value: str
    display: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        display = self.display

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "value": value,
            }
        )
        if display is not UNSET:
            field_dict["display"] = display

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        value = d.pop("value")

        display = d.pop("display", UNSET)

        scim_replace_group_response_200_members_item = cls(
            value=value,
            display=display,
        )

        return scim_replace_group_response_200_members_item
