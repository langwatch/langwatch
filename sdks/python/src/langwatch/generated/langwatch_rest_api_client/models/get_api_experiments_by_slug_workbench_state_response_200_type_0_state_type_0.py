from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0")


@_attrs_define
class GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0:
    """The experiment setup: datasets, targets and evaluators. Read it, change it, send it back whole."""

    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        get_api_experiments_by_slug_workbench_state_response_200_type_0_state_type_0 = cls()

        get_api_experiments_by_slug_workbench_state_response_200_type_0_state_type_0.additional_properties = d
        return get_api_experiments_by_slug_workbench_state_response_200_type_0_state_type_0

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
