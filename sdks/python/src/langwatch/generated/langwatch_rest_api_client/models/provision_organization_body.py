from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProvisionOrganizationBody")


@_attrs_define
class ProvisionOrganizationBody:
    """
    Attributes:
        name (str):
        slug (str | Unset):
        admin_api_key_name (str | Unset):
    """

    name: str
    slug: str | Unset = UNSET
    admin_api_key_name: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        slug = self.slug

        admin_api_key_name = self.admin_api_key_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if slug is not UNSET:
            field_dict["slug"] = slug
        if admin_api_key_name is not UNSET:
            field_dict["adminApiKeyName"] = admin_api_key_name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        slug = d.pop("slug", UNSET)

        admin_api_key_name = d.pop("adminApiKeyName", UNSET)

        provision_organization_body = cls(
            name=name,
            slug=slug,
            admin_api_key_name=admin_api_key_name,
        )

        provision_organization_body.additional_properties = d
        return provision_organization_body

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
