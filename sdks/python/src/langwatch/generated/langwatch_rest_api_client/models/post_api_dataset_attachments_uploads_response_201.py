from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dataset_attachments_uploads_response_201_headers import (
        PostApiDatasetAttachmentsUploadsResponse201Headers,
    )


T = TypeVar("T", bound="PostApiDatasetAttachmentsUploadsResponse201")


@_attrs_define
class PostApiDatasetAttachmentsUploadsResponse201:
    """
    Attributes:
        object_id (str):
        upload_url (str):
        method (Literal['PUT']):
        expires_at (str):
        headers (PostApiDatasetAttachmentsUploadsResponse201Headers | Unset):
    """

    object_id: str
    upload_url: str
    method: Literal["PUT"]
    expires_at: str
    headers: PostApiDatasetAttachmentsUploadsResponse201Headers | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        object_id = self.object_id

        upload_url = self.upload_url

        method = self.method

        expires_at = self.expires_at

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
        from ..models.post_api_dataset_attachments_uploads_response_201_headers import (
            PostApiDatasetAttachmentsUploadsResponse201Headers,
        )

        d = dict(src_dict)
        object_id = d.pop("objectId")

        upload_url = d.pop("uploadUrl")

        method = cast(Literal["PUT"], d.pop("method"))
        if method != "PUT":
            raise ValueError(f"method must match const 'PUT', got '{method}'")

        expires_at = d.pop("expiresAt")

        _headers = d.pop("headers", UNSET)
        headers: PostApiDatasetAttachmentsUploadsResponse201Headers | Unset
        if isinstance(_headers, Unset):
            headers = UNSET
        else:
            headers = PostApiDatasetAttachmentsUploadsResponse201Headers.from_dict(_headers)

        post_api_dataset_attachments_uploads_response_201 = cls(
            object_id=object_id,
            upload_url=upload_url,
            method=method,
            expires_at=expires_at,
            headers=headers,
        )

        return post_api_dataset_attachments_uploads_response_201
