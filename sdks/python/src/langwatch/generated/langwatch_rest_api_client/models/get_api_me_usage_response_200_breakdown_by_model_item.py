from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiMeUsageResponse200BreakdownByModelItem")


@_attrs_define
class GetApiMeUsageResponse200BreakdownByModelItem:
    """
    Attributes:
        label (str):
        spent_usd (float):
        billed_usd (float):
        requests (float):
    """

    label: str
    spent_usd: float
    billed_usd: float
    requests: float

    def to_dict(self) -> dict[str, Any]:
        label = self.label

        spent_usd = self.spent_usd

        billed_usd = self.billed_usd

        requests = self.requests

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "label": label,
                "spentUsd": spent_usd,
                "billedUsd": billed_usd,
                "requests": requests,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        label = d.pop("label")

        spent_usd = d.pop("spentUsd")

        billed_usd = d.pop("billedUsd")

        requests = d.pop("requests")

        get_api_me_usage_response_200_breakdown_by_model_item = cls(
            label=label,
            spent_usd=spent_usd,
            billed_usd=billed_usd,
            requests=requests,
        )

        return get_api_me_usage_response_200_breakdown_by_model_item
