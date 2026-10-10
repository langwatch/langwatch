from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_create_group_body_members_item import ScimCreateGroupBodyMembersItem


T = TypeVar("T", bound="ScimCreateGroupBody")


@_attrs_define
class ScimCreateGroupBody:
    """
    Attributes:
        schemas (list[str]):
        display_name (str):
        external_id (str | Unset):
        members (list[ScimCreateGroupBodyMembersItem] | Unset):
    """

    schemas: list[str]
    display_name: str
    external_id: str | Unset = UNSET
    members: list[ScimCreateGroupBodyMembersItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        display_name = self.display_name

        external_id = self.external_id

        members: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.members, Unset):
            members = []
            for members_item_data in self.members:
                members_item = members_item_data.to_dict()
                members.append(members_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "schemas": schemas,
                "displayName": display_name,
            }
        )
        if external_id is not UNSET:
            field_dict["externalId"] = external_id
        if members is not UNSET:
            field_dict["members"] = members

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_create_group_body_members_item import ScimCreateGroupBodyMembersItem

        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas"))

        display_name = d.pop("displayName")

        external_id = d.pop("externalId", UNSET)

        _members = d.pop("members", UNSET)
        members: list[ScimCreateGroupBodyMembersItem] | Unset = UNSET
        if _members is not UNSET:
            members = []
            for members_item_data in _members:
                members_item = ScimCreateGroupBodyMembersItem.from_dict(members_item_data)

                members.append(members_item)

        scim_create_group_body = cls(
            schemas=schemas,
            display_name=display_name,
            external_id=external_id,
            members=members,
        )

        scim_create_group_body.additional_properties = d
        return scim_create_group_body

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
