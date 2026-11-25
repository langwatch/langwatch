from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiMeUsageResponse200SummaryMostUsedModelType0")


@_attrs_define
class GetApiMeUsageResponse200SummaryMostUsedModelType0:
    """
    Attributes:
        name (str):
        usage_pct (float):
    """

    name: str
    usage_pct: float

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        usage_pct = self.usage_pct

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "usagePct": usage_pct,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        usage_pct = d.pop("usagePct")

        get_api_me_usage_response_200_summary_most_used_model_type_0 = cls(
            name=name,
            usage_pct=usage_pct,
        )

        return get_api_me_usage_response_200_summary_most_used_model_type_0
