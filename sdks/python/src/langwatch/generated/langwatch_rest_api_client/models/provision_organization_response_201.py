from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.provision_organization_response_201_admin_api_key import ProvisionOrganizationResponse201AdminApiKey
    from ..models.provision_organization_response_201_organization import ProvisionOrganizationResponse201Organization


T = TypeVar("T", bound="ProvisionOrganizationResponse201")


@_attrs_define
class ProvisionOrganizationResponse201:
    """
    Attributes:
        organization (ProvisionOrganizationResponse201Organization):
        team (Any):
        admin_api_key (ProvisionOrganizationResponse201AdminApiKey):
    """

    organization: ProvisionOrganizationResponse201Organization
    team: Any
    admin_api_key: ProvisionOrganizationResponse201AdminApiKey
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        organization = self.organization.to_dict()

        team = self.team

        admin_api_key = self.admin_api_key.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "organization": organization,
                "team": team,
                "adminApiKey": admin_api_key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provision_organization_response_201_admin_api_key import (
            ProvisionOrganizationResponse201AdminApiKey,
        )
        from ..models.provision_organization_response_201_organization import (
            ProvisionOrganizationResponse201Organization,
        )

        d = dict(src_dict)
        organization = ProvisionOrganizationResponse201Organization.from_dict(d.pop("organization"))

        team = d.pop("team")

        admin_api_key = ProvisionOrganizationResponse201AdminApiKey.from_dict(d.pop("adminApiKey"))

        provision_organization_response_201 = cls(
            organization=organization,
            team=team,
            admin_api_key=admin_api_key,
        )

        provision_organization_response_201.additional_properties = d
        return provision_organization_response_201

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
