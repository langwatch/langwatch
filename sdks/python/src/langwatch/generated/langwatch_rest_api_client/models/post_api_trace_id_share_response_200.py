from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiTraceIdShareResponse200")


@_attrs_define
class PostApiTraceIdShareResponse200:
    """
    Attributes:
        status (Literal['success']):
        path (str):
    """

    status: Literal["success"]
    path: str

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "path": path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = cast(Literal["success"], d.pop("status"))
        if status != "success":
            raise ValueError(f"status must match const 'success', got '{status}'")

        path = d.pop("path")

        post_api_trace_id_share_response_200 = cls(
            status=status,
            path=path,
        )

        return post_api_trace_id_share_response_200
