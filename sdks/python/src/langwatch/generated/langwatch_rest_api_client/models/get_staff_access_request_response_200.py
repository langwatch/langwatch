from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_staff_access_request_response_200_status import GetStaffAccessRequestResponse200Status

T = TypeVar("T", bound="GetStaffAccessRequestResponse200")


@_attrs_define
class GetStaffAccessRequestResponse200:
    """
    Attributes:
        request_id (str):
        status (GetStaffAccessRequestResponse200Status):
        expires_at (str):
        access_expires_at (None | str):
    """

    request_id: str
    status: GetStaffAccessRequestResponse200Status
    expires_at: str
    access_expires_at: None | str

    def to_dict(self) -> dict[str, Any]:
        request_id = self.request_id

        status = self.status.value

        expires_at = self.expires_at

        access_expires_at: None | str
        access_expires_at = self.access_expires_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "requestId": request_id,
                "status": status,
                "expiresAt": expires_at,
                "accessExpiresAt": access_expires_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        request_id = d.pop("requestId")

        status = GetStaffAccessRequestResponse200Status(d.pop("status"))

        expires_at = d.pop("expiresAt")

        def _parse_access_expires_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        access_expires_at = _parse_access_expires_at(d.pop("accessExpiresAt"))

        get_staff_access_request_response_200 = cls(
            request_id=request_id,
            status=status,
            expires_at=expires_at,
            access_expires_at=access_expires_at,
        )

        return get_staff_access_request_response_200
