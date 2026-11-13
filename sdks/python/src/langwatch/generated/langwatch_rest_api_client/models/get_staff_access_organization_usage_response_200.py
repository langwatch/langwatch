from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_staff_access_organization_usage_response_200_api_keys_item import (
        GetStaffAccessOrganizationUsageResponse200ApiKeysItem,
    )
    from ..models.get_staff_access_organization_usage_response_200_coding_agent_sessions import (
        GetStaffAccessOrganizationUsageResponse200CodingAgentSessions,
    )
    from ..models.get_staff_access_organization_usage_response_200_gateway import (
        GetStaffAccessOrganizationUsageResponse200Gateway,
    )
    from ..models.get_staff_access_organization_usage_response_200_organization import (
        GetStaffAccessOrganizationUsageResponse200Organization,
    )


T = TypeVar("T", bound="GetStaffAccessOrganizationUsageResponse200")


@_attrs_define
class GetStaffAccessOrganizationUsageResponse200:
    """
    Attributes:
        organization (GetStaffAccessOrganizationUsageResponse200Organization):
        at (str):
        coding_agent_sessions (GetStaffAccessOrganizationUsageResponse200CodingAgentSessions):
        gateway (GetStaffAccessOrganizationUsageResponse200Gateway):
        traces_30_days (int):
        api_keys (list[GetStaffAccessOrganizationUsageResponse200ApiKeysItem]):
        members_signed_in (int):
        classification (str):
    """

    organization: GetStaffAccessOrganizationUsageResponse200Organization
    at: str
    coding_agent_sessions: GetStaffAccessOrganizationUsageResponse200CodingAgentSessions
    gateway: GetStaffAccessOrganizationUsageResponse200Gateway
    traces_30_days: int
    api_keys: list[GetStaffAccessOrganizationUsageResponse200ApiKeysItem]
    members_signed_in: int
    classification: str

    def to_dict(self) -> dict[str, Any]:
        organization = self.organization.to_dict()

        at = self.at

        coding_agent_sessions = self.coding_agent_sessions.to_dict()

        gateway = self.gateway.to_dict()

        traces_30_days = self.traces_30_days

        api_keys = []
        for api_keys_item_data in self.api_keys:
            api_keys_item = api_keys_item_data.to_dict()
            api_keys.append(api_keys_item)

        members_signed_in = self.members_signed_in

        classification = self.classification

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organization": organization,
                "at": at,
                "codingAgentSessions": coding_agent_sessions,
                "gateway": gateway,
                "traces30Days": traces_30_days,
                "apiKeys": api_keys,
                "membersSignedIn": members_signed_in,
                "classification": classification,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_staff_access_organization_usage_response_200_api_keys_item import (
            GetStaffAccessOrganizationUsageResponse200ApiKeysItem,
        )
        from ..models.get_staff_access_organization_usage_response_200_coding_agent_sessions import (
            GetStaffAccessOrganizationUsageResponse200CodingAgentSessions,
        )
        from ..models.get_staff_access_organization_usage_response_200_gateway import (
            GetStaffAccessOrganizationUsageResponse200Gateway,
        )
        from ..models.get_staff_access_organization_usage_response_200_organization import (
            GetStaffAccessOrganizationUsageResponse200Organization,
        )

        d = dict(src_dict)
        organization = GetStaffAccessOrganizationUsageResponse200Organization.from_dict(d.pop("organization"))

        at = d.pop("at")

        coding_agent_sessions = GetStaffAccessOrganizationUsageResponse200CodingAgentSessions.from_dict(
            d.pop("codingAgentSessions")
        )

        gateway = GetStaffAccessOrganizationUsageResponse200Gateway.from_dict(d.pop("gateway"))

        traces_30_days = d.pop("traces30Days")

        api_keys = []
        _api_keys = d.pop("apiKeys")
        for api_keys_item_data in _api_keys:
            api_keys_item = GetStaffAccessOrganizationUsageResponse200ApiKeysItem.from_dict(api_keys_item_data)

            api_keys.append(api_keys_item)

        members_signed_in = d.pop("membersSignedIn")

        classification = d.pop("classification")

        get_staff_access_organization_usage_response_200 = cls(
            organization=organization,
            at=at,
            coding_agent_sessions=coding_agent_sessions,
            gateway=gateway,
            traces_30_days=traces_30_days,
            api_keys=api_keys,
            members_signed_in=members_signed_in,
            classification=classification,
        )

        return get_staff_access_organization_usage_response_200
