from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_organizations_response_200_organizations_item import (
        ListOrganizationsResponse200OrganizationsItem,
    )


T = TypeVar("T", bound="ListOrganizationsResponse200")


@_attrs_define
class ListOrganizationsResponse200:
    """
    Attributes:
        organizations (list[ListOrganizationsResponse200OrganizationsItem]):
    """

    organizations: list[ListOrganizationsResponse200OrganizationsItem]

    def to_dict(self) -> dict[str, Any]:
        organizations = []
        for organizations_item_data in self.organizations:
            organizations_item = organizations_item_data.to_dict()
            organizations.append(organizations_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organizations": organizations,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_organizations_response_200_organizations_item import (
            ListOrganizationsResponse200OrganizationsItem,
        )

        d = dict(src_dict)
        organizations = []
        _organizations = d.pop("organizations")
        for organizations_item_data in _organizations:
            organizations_item = ListOrganizationsResponse200OrganizationsItem.from_dict(organizations_item_data)

            organizations.append(organizations_item)

        list_organizations_response_200 = cls(
            organizations=organizations,
        )

        return list_organizations_response_200
