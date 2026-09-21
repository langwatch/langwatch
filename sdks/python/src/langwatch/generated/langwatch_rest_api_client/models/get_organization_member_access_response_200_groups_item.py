from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_organization_member_access_response_200_groups_item_bindings_item import (
        GetOrganizationMemberAccessResponse200GroupsItemBindingsItem,
    )


T = TypeVar("T", bound="GetOrganizationMemberAccessResponse200GroupsItem")


@_attrs_define
class GetOrganizationMemberAccessResponse200GroupsItem:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        scim_source (None | str):
        bindings (list[GetOrganizationMemberAccessResponse200GroupsItemBindingsItem]):
    """

    id: str
    name: str
    slug: str
    scim_source: None | str
    bindings: list[GetOrganizationMemberAccessResponse200GroupsItemBindingsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        scim_source: None | str
        scim_source = self.scim_source

        bindings = []
        for bindings_item_data in self.bindings:
            bindings_item = bindings_item_data.to_dict()
            bindings.append(bindings_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "scimSource": scim_source,
                "bindings": bindings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_organization_member_access_response_200_groups_item_bindings_item import (
            GetOrganizationMemberAccessResponse200GroupsItemBindingsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        def _parse_scim_source(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        scim_source = _parse_scim_source(d.pop("scimSource"))

        bindings = []
        _bindings = d.pop("bindings")
        for bindings_item_data in _bindings:
            bindings_item = GetOrganizationMemberAccessResponse200GroupsItemBindingsItem.from_dict(bindings_item_data)

            bindings.append(bindings_item)

        get_organization_member_access_response_200_groups_item = cls(
            id=id,
            name=name,
            slug=slug,
            scim_source=scim_source,
            bindings=bindings,
        )

        get_organization_member_access_response_200_groups_item.additional_properties = d
        return get_organization_member_access_response_200_groups_item

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
