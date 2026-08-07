from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        usage_pct = self.usage_pct

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        get_api_me_usage_response_200_summary_most_used_model_type_0.additional_properties = d
        return get_api_me_usage_response_200_summary_most_used_model_type_0

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
