from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provision_organization_response_201_admin_api_key import ProvisionOrganizationResponse201AdminApiKey
    from ..models.provision_organization_response_201_organization import ProvisionOrganizationResponse201Organization
    from ..models.provision_organization_response_201_team import ProvisionOrganizationResponse201Team


T = TypeVar("T", bound="ProvisionOrganizationResponse201")


@_attrs_define
class ProvisionOrganizationResponse201:
    """
    Attributes:
        organization (ProvisionOrganizationResponse201Organization | Unset):
        team (ProvisionOrganizationResponse201Team | Unset):
        admin_api_key (ProvisionOrganizationResponse201AdminApiKey | Unset):
    """

    organization: ProvisionOrganizationResponse201Organization | Unset = UNSET
    team: ProvisionOrganizationResponse201Team | Unset = UNSET
    admin_api_key: ProvisionOrganizationResponse201AdminApiKey | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        organization: dict[str, Any] | Unset = UNSET
        if not isinstance(self.organization, Unset):
            organization = self.organization.to_dict()

        team: dict[str, Any] | Unset = UNSET
        if not isinstance(self.team, Unset):
            team = self.team.to_dict()

        admin_api_key: dict[str, Any] | Unset = UNSET
        if not isinstance(self.admin_api_key, Unset):
            admin_api_key = self.admin_api_key.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if organization is not UNSET:
            field_dict["organization"] = organization
        if team is not UNSET:
            field_dict["team"] = team
        if admin_api_key is not UNSET:
            field_dict["adminApiKey"] = admin_api_key

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provision_organization_response_201_admin_api_key import (
            ProvisionOrganizationResponse201AdminApiKey,
        )
        from ..models.provision_organization_response_201_organization import (
            ProvisionOrganizationResponse201Organization,
        )
        from ..models.provision_organization_response_201_team import ProvisionOrganizationResponse201Team

        d = dict(src_dict)
        _organization = d.pop("organization", UNSET)
        organization: ProvisionOrganizationResponse201Organization | Unset
        if isinstance(_organization, Unset):
            organization = UNSET
        else:
            organization = ProvisionOrganizationResponse201Organization.from_dict(_organization)

        _team = d.pop("team", UNSET)
        team: ProvisionOrganizationResponse201Team | Unset
        if isinstance(_team, Unset):
            team = UNSET
        else:
            team = ProvisionOrganizationResponse201Team.from_dict(_team)

        _admin_api_key = d.pop("adminApiKey", UNSET)
        admin_api_key: ProvisionOrganizationResponse201AdminApiKey | Unset
        if isinstance(_admin_api_key, Unset):
            admin_api_key = UNSET
        else:
            admin_api_key = ProvisionOrganizationResponse201AdminApiKey.from_dict(_admin_api_key)

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
