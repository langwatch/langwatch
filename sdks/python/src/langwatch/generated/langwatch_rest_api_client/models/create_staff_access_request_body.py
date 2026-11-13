from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..models.create_staff_access_request_body_scopes_item import CreateStaffAccessRequestBodyScopesItem
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateStaffAccessRequestBody")


@_attrs_define
class CreateStaffAccessRequestBody:
    """
    Attributes:
        scopes (list[CreateStaffAccessRequestBodyScopesItem]):
        reason (str):
        code_challenge (str):
        code_challenge_method (Literal['S256']):
        machine (str):
        organization (str | Unset):
    """

    scopes: list[CreateStaffAccessRequestBodyScopesItem]
    reason: str
    code_challenge: str
    code_challenge_method: Literal["S256"]
    machine: str
    organization: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        scopes = []
        for scopes_item_data in self.scopes:
            scopes_item = scopes_item_data.value
            scopes.append(scopes_item)

        reason = self.reason

        code_challenge = self.code_challenge

        code_challenge_method = self.code_challenge_method

        machine = self.machine

        organization = self.organization

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "scopes": scopes,
                "reason": reason,
                "codeChallenge": code_challenge,
                "codeChallengeMethod": code_challenge_method,
                "machine": machine,
            }
        )
        if organization is not UNSET:
            field_dict["organization"] = organization

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scopes = []
        _scopes = d.pop("scopes")
        for scopes_item_data in _scopes:
            scopes_item = CreateStaffAccessRequestBodyScopesItem(scopes_item_data)

            scopes.append(scopes_item)

        reason = d.pop("reason")

        code_challenge = d.pop("codeChallenge")

        code_challenge_method = cast(Literal["S256"], d.pop("codeChallengeMethod"))
        if code_challenge_method != "S256":
            raise ValueError(f"codeChallengeMethod must match const 'S256', got '{code_challenge_method}'")

        machine = d.pop("machine")

        organization = d.pop("organization", UNSET)

        create_staff_access_request_body = cls(
            scopes=scopes,
            reason=reason,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            machine=machine,
            organization=organization,
        )

        return create_staff_access_request_body
