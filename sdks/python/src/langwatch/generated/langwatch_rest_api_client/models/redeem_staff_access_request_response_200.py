from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.redeem_staff_access_request_response_200_scopes_item import RedeemStaffAccessRequestResponse200ScopesItem
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.redeem_staff_access_request_response_200_projects_item import (
        RedeemStaffAccessRequestResponse200ProjectsItem,
    )


T = TypeVar("T", bound="RedeemStaffAccessRequestResponse200")


@_attrs_define
class RedeemStaffAccessRequestResponse200:
    """
    Attributes:
        projects (list[RedeemStaffAccessRequestResponse200ProjectsItem]):
        scopes (list[RedeemStaffAccessRequestResponse200ScopesItem]):
        expires_at (str):
        api_key (str | Unset):
        ops_token (str | Unset):
        organization_id (str | Unset):
    """

    projects: list[RedeemStaffAccessRequestResponse200ProjectsItem]
    scopes: list[RedeemStaffAccessRequestResponse200ScopesItem]
    expires_at: str
    api_key: str | Unset = UNSET
    ops_token: str | Unset = UNSET
    organization_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        projects = []
        for projects_item_data in self.projects:
            projects_item = projects_item_data.to_dict()
            projects.append(projects_item)

        scopes = []
        for scopes_item_data in self.scopes:
            scopes_item = scopes_item_data.value
            scopes.append(scopes_item)

        expires_at = self.expires_at

        api_key = self.api_key

        ops_token = self.ops_token

        organization_id = self.organization_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "projects": projects,
                "scopes": scopes,
                "expiresAt": expires_at,
            }
        )
        if api_key is not UNSET:
            field_dict["apiKey"] = api_key
        if ops_token is not UNSET:
            field_dict["opsToken"] = ops_token
        if organization_id is not UNSET:
            field_dict["organizationId"] = organization_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.redeem_staff_access_request_response_200_projects_item import (
            RedeemStaffAccessRequestResponse200ProjectsItem,
        )

        d = dict(src_dict)
        projects = []
        _projects = d.pop("projects")
        for projects_item_data in _projects:
            projects_item = RedeemStaffAccessRequestResponse200ProjectsItem.from_dict(projects_item_data)

            projects.append(projects_item)

        scopes = []
        _scopes = d.pop("scopes")
        for scopes_item_data in _scopes:
            scopes_item = RedeemStaffAccessRequestResponse200ScopesItem(scopes_item_data)

            scopes.append(scopes_item)

        expires_at = d.pop("expiresAt")

        api_key = d.pop("apiKey", UNSET)

        ops_token = d.pop("opsToken", UNSET)

        organization_id = d.pop("organizationId", UNSET)

        redeem_staff_access_request_response_200 = cls(
            projects=projects,
            scopes=scopes,
            expires_at=expires_at,
            api_key=api_key,
            ops_token=ops_token,
            organization_id=organization_id,
        )

        return redeem_staff_access_request_response_200
