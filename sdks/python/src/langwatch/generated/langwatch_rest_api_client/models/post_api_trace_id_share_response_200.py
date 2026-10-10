from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        path = self.path

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_trace_id_share_response_200.additional_properties = d
        return post_api_trace_id_share_response_200

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
