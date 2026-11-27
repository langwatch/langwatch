from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiGovernanceRegistrySettingsResponse200Data")


@_attrs_define
class GetApiGovernanceRegistrySettingsResponse200Data:
    """
    Attributes:
        dormant_after_days (int):
    """

    dormant_after_days: int

    def to_dict(self) -> dict[str, Any]:
        dormant_after_days = self.dormant_after_days

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "dormant_after_days": dormant_after_days,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        dormant_after_days = d.pop("dormant_after_days")

        get_api_governance_registry_settings_response_200_data = cls(
            dormant_after_days=dormant_after_days,
        )

        return get_api_governance_registry_settings_response_200_data
