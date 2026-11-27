from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.put_api_governance_registry_settings_response_200_data import (
        PutApiGovernanceRegistrySettingsResponse200Data,
    )


T = TypeVar("T", bound="PutApiGovernanceRegistrySettingsResponse200")


@_attrs_define
class PutApiGovernanceRegistrySettingsResponse200:
    """
    Attributes:
        data (PutApiGovernanceRegistrySettingsResponse200Data):
    """

    data: PutApiGovernanceRegistrySettingsResponse200Data

    def to_dict(self) -> dict[str, Any]:
        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_governance_registry_settings_response_200_data import (
            PutApiGovernanceRegistrySettingsResponse200Data,
        )

        d = dict(src_dict)
        data = PutApiGovernanceRegistrySettingsResponse200Data.from_dict(d.pop("data"))

        put_api_governance_registry_settings_response_200 = cls(
            data=data,
        )

        return put_api_governance_registry_settings_response_200
