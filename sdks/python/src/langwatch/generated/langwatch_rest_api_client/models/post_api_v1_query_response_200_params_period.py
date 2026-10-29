from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiV1QueryResponse200ParamsPeriod")


@_attrs_define
class PostApiV1QueryResponse200ParamsPeriod:
    """
    Attributes:
        start (str):
        end (str):
    """

    start: str
    end: str

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        end = self.end

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "start": start,
                "end": end,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start")

        end = d.pop("end")

        post_api_v1_query_response_200_params_period = cls(
            start=start,
            end=end,
        )

        return post_api_v1_query_response_200_params_period
