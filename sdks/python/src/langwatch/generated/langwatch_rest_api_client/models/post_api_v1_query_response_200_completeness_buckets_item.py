from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        n = self.n

        field_dict: dict[str, Any] = {}

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

        return post_api_v1_query_response_200_completeness_buckets_item
