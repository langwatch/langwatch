from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1QueryResponse200CompletenessBucketsItem")


@_attrs_define
class PostApiV1QueryResponse200CompletenessBucketsItem:
    """
    Attributes:
        start (str):
        n (float):
    """

    start: str
    n: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        n = self.n

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "start": start,
                "n": n,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start")

        n = d.pop("n")

        post_api_v1_query_response_200_completeness_buckets_item = cls(
            start=start,
            n=n,
        )

        post_api_v1_query_response_200_completeness_buckets_item.additional_properties = d
        return post_api_v1_query_response_200_completeness_buckets_item

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
