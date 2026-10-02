from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_v1_query_response_200_diagnostics_item_code import PostApiV1QueryResponse200DiagnosticsItemCode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_query_response_200_diagnostics_item_meta import (
        PostApiV1QueryResponse200DiagnosticsItemMeta,
    )


T = TypeVar("T", bound="PostApiV1QueryResponse200DiagnosticsItem")


@_attrs_define
class PostApiV1QueryResponse200DiagnosticsItem:
    """
    Attributes:
        code (PostApiV1QueryResponse200DiagnosticsItemCode):
        message (str):
        meta (PostApiV1QueryResponse200DiagnosticsItemMeta | Unset):
    """

    code: PostApiV1QueryResponse200DiagnosticsItemCode
    message: str
    meta: PostApiV1QueryResponse200DiagnosticsItemMeta | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        message = self.message

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_query_response_200_diagnostics_item_meta import (
            PostApiV1QueryResponse200DiagnosticsItemMeta,
        )

        d = dict(src_dict)
        code = PostApiV1QueryResponse200DiagnosticsItemCode(d.pop("code"))

        message = d.pop("message")

        _meta = d.pop("meta", UNSET)
        meta: PostApiV1QueryResponse200DiagnosticsItemMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = PostApiV1QueryResponse200DiagnosticsItemMeta.from_dict(_meta)

        post_api_v1_query_response_200_diagnostics_item = cls(
            code=code,
            message=message,
            meta=meta,
        )

        return post_api_v1_query_response_200_diagnostics_item
