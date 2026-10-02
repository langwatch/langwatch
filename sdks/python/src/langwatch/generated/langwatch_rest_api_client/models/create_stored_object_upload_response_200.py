from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_stored_object_upload_response_200_headers import CreateStoredObjectUploadResponse200Headers


T = TypeVar("T", bound="CreateStoredObjectUploadResponse200")


@_attrs_define
class CreateStoredObjectUploadResponse200:
    """
    Attributes:
        object_id (str):
        upload_url (str):
        method (Literal['PUT']):
        expires_at (datetime.datetime):
        headers (CreateStoredObjectUploadResponse200Headers | Unset):
    """

    object_id: str
    upload_url: str
    method: Literal["PUT"]
    expires_at: datetime.datetime
    headers: CreateStoredObjectUploadResponse200Headers | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        object_id = self.object_id

        upload_url = self.upload_url

        method = self.method

        expires_at = self.expires_at.isoformat()

        headers: dict[str, Any] | Unset = UNSET
        if not isinstance(self.headers, Unset):
            headers = self.headers.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "objectId": object_id,
                "uploadUrl": upload_url,
                "method": method,
                "expiresAt": expires_at,
            }
        )
        if headers is not UNSET:
            field_dict["headers"] = headers

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_stored_object_upload_response_200_headers import CreateStoredObjectUploadResponse200Headers

        d = dict(src_dict)
        object_id = d.pop("objectId")

        upload_url = d.pop("uploadUrl")

        method = cast(Literal["PUT"], d.pop("method"))
        if method != "PUT":
            raise ValueError(f"method must match const 'PUT', got '{method}'")

        expires_at = isoparse(d.pop("expiresAt"))

        _headers = d.pop("headers", UNSET)
        headers: CreateStoredObjectUploadResponse200Headers | Unset
        if isinstance(_headers, Unset):
            headers = UNSET
        else:
            headers = CreateStoredObjectUploadResponse200Headers.from_dict(_headers)

        create_stored_object_upload_response_200 = cls(
            object_id=object_id,
            upload_url=upload_url,
            method=method,
            expires_at=expires_at,
            headers=headers,
        )

        return create_stored_object_upload_response_200
