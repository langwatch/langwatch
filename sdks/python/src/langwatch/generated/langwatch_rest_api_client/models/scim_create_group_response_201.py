from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_create_group_response_201_members_item import ScimCreateGroupResponse201MembersItem
    from ..models.scim_create_group_response_201_meta import ScimCreateGroupResponse201Meta


T = TypeVar("T", bound="ScimCreateGroupResponse201")


@_attrs_define
class ScimCreateGroupResponse201:
    """
    Attributes:
        schemas (list[str] | Unset): The SCIM schema URNs this resource conforms to.
        id (str | Unset): The LangWatch group id.
        display_name (str | Unset):
        members (list[ScimCreateGroupResponse201MembersItem] | Unset): Omitted when the request excluded the members
            attribute. Each value is a LangWatch user id.
        meta (ScimCreateGroupResponse201Meta | Unset):
    """

    schemas: list[str] | Unset = UNSET
    id: str | Unset = UNSET
    display_name: str | Unset = UNSET
    members: list[ScimCreateGroupResponse201MembersItem] | Unset = UNSET
    meta: ScimCreateGroupResponse201Meta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas: list[str] | Unset = UNSET
        if not isinstance(self.schemas, Unset):
            schemas = self.schemas

        id = self.id

        display_name = self.display_name

        members: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.members, Unset):
            members = []
            for members_item_data in self.members:
                members_item = members_item_data.to_dict()
                members.append(members_item)

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if schemas is not UNSET:
            field_dict["schemas"] = schemas
        if id is not UNSET:
            field_dict["id"] = id
        if display_name is not UNSET:
            field_dict["displayName"] = display_name
        if members is not UNSET:
            field_dict["members"] = members
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_create_group_response_201_members_item import ScimCreateGroupResponse201MembersItem
        from ..models.scim_create_group_response_201_meta import ScimCreateGroupResponse201Meta

        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas", UNSET))

        id = d.pop("id", UNSET)

        display_name = d.pop("displayName", UNSET)

        _members = d.pop("members", UNSET)
        members: list[ScimCreateGroupResponse201MembersItem] | Unset = UNSET
        if _members is not UNSET:
            members = []
            for members_item_data in _members:
                members_item = ScimCreateGroupResponse201MembersItem.from_dict(members_item_data)

                members.append(members_item)

        _meta = d.pop("meta", UNSET)
        meta: ScimCreateGroupResponse201Meta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = ScimCreateGroupResponse201Meta.from_dict(_meta)

        scim_create_group_response_201 = cls(
            schemas=schemas,
            id=id,
            display_name=display_name,
            members=members,
            meta=meta,
        )

        scim_create_group_response_201.additional_properties = d
        return scim_create_group_response_201

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
