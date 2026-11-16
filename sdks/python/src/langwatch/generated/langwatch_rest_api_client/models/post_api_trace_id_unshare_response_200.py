from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiTraceIdUnshareResponse200")


@_attrs_define
class PostApiTraceIdUnshareResponse200:
    """
    Attributes:
        status (Literal['success']):
    """

    status: Literal["success"]

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = cast(Literal["success"], d.pop("status"))
        if status != "success":
            raise ValueError(f"status must match const 'success', got '{status}'")

        post_api_trace_id_unshare_response_200 = cls(
            status=status,
        )

        return post_api_trace_id_unshare_response_200
