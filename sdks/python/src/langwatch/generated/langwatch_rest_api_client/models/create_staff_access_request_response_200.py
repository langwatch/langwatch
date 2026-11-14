from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CreateStaffAccessRequestResponse200")


@_attrs_define
class CreateStaffAccessRequestResponse200:
    """
    Attributes:
        request_id (str):
        approval_url (str):
        expires_at (str):
    """

    request_id: str
    approval_url: str
    expires_at: str

    def to_dict(self) -> dict[str, Any]:
        request_id = self.request_id

        approval_url = self.approval_url

        expires_at = self.expires_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "requestId": request_id,
                "approvalUrl": approval_url,
                "expiresAt": expires_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        request_id = d.pop("requestId")

        approval_url = d.pop("approvalUrl")

        expires_at = d.pop("expiresAt")

        create_staff_access_request_response_200 = cls(
            request_id=request_id,
            approval_url=approval_url,
            expires_at=expires_at,
        )

        return create_staff_access_request_response_200
