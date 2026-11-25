from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.provision_organization_response_201_admin_api_key import ProvisionOrganizationResponse201AdminApiKey
    from ..models.provision_organization_response_201_organization import ProvisionOrganizationResponse201Organization
    from ..models.provision_organization_response_201_team import ProvisionOrganizationResponse201Team


T = TypeVar("T", bound="ProvisionOrganizationResponse201")


@_attrs_define
class ProvisionOrganizationResponse201:
    """
    Attributes:
        organization (ProvisionOrganizationResponse201Organization):
        team (ProvisionOrganizationResponse201Team):
        admin_api_key (ProvisionOrganizationResponse201AdminApiKey):
    """

    organization: ProvisionOrganizationResponse201Organization
    team: ProvisionOrganizationResponse201Team
    admin_api_key: ProvisionOrganizationResponse201AdminApiKey

    def to_dict(self) -> dict[str, Any]:
        organization = self.organization.to_dict()

        team = self.team.to_dict()

        admin_api_key = self.admin_api_key.to_dict()

        field_dict: dict[str, Any] = {}

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
        from ..models.provision_organization_response_201_team import ProvisionOrganizationResponse201Team

        d = dict(src_dict)
        organization = ProvisionOrganizationResponse201Organization.from_dict(d.pop("organization"))

        team = ProvisionOrganizationResponse201Team.from_dict(d.pop("team"))

        admin_api_key = ProvisionOrganizationResponse201AdminApiKey.from_dict(d.pop("adminApiKey"))

        provision_organization_response_201 = cls(
            organization=organization,
            team=team,
            admin_api_key=admin_api_key,
        )

        return provision_organization_response_201
