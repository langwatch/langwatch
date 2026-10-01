from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_groups_by_id_response_200_bindings_item import GetApiGroupsByIdResponse200BindingsItem
    from ..models.get_api_groups_by_id_response_200_members_item import GetApiGroupsByIdResponse200MembersItem


T = TypeVar("T", bound="GetApiGroupsByIdResponse200")


@_attrs_define
class GetApiGroupsByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        external_id (None | str):
        scim_source (None | str):
        members (list[GetApiGroupsByIdResponse200MembersItem]):
        bindings (list[GetApiGroupsByIdResponse200BindingsItem]):
    """

    id: str
    name: str
    slug: str
    external_id: None | str
    scim_source: None | str
    members: list[GetApiGroupsByIdResponse200MembersItem]
    bindings: list[GetApiGroupsByIdResponse200BindingsItem]

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        external_id: None | str
        external_id = self.external_id

        scim_source: None | str
        scim_source = self.scim_source

        members = []
        for members_item_data in self.members:
            members_item = members_item_data.to_dict()
            members.append(members_item)

        bindings = []
        for bindings_item_data in self.bindings:
            bindings_item = bindings_item_data.to_dict()
            bindings.append(bindings_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "externalId": external_id,
                "scimSource": scim_source,
                "members": members,
                "bindings": bindings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_groups_by_id_response_200_bindings_item import GetApiGroupsByIdResponse200BindingsItem
        from ..models.get_api_groups_by_id_response_200_members_item import GetApiGroupsByIdResponse200MembersItem

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        def _parse_external_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        external_id = _parse_external_id(d.pop("externalId"))

        def _parse_scim_source(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        scim_source = _parse_scim_source(d.pop("scimSource"))

        members = []
        _members = d.pop("members")
        for members_item_data in _members:
            members_item = GetApiGroupsByIdResponse200MembersItem.from_dict(members_item_data)

            members.append(members_item)

        bindings = []
        _bindings = d.pop("bindings")
        for bindings_item_data in _bindings:
            bindings_item = GetApiGroupsByIdResponse200BindingsItem.from_dict(bindings_item_data)

            bindings.append(bindings_item)

        get_api_groups_by_id_response_200 = cls(
            id=id,
            name=name,
            slug=slug,
            external_id=external_id,
            scim_source=scim_source,
            members=members,
            bindings=bindings,
        )

        return get_api_groups_by_id_response_200
