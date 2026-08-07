from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_simulation_runs_batches_list_response_200_batches_item import (
        GetApiSimulationRunsBatchesListResponse200BatchesItem,
    )


T = TypeVar("T", bound="GetApiSimulationRunsBatchesListResponse200")


@_attrs_define
class GetApiSimulationRunsBatchesListResponse200:
    """
    Attributes:
        batches (list[GetApiSimulationRunsBatchesListResponse200BatchesItem]):
        has_more (bool | Unset):
        next_cursor (str | Unset):
    """

    batches: list[GetApiSimulationRunsBatchesListResponse200BatchesItem]
    has_more: bool | Unset = UNSET
    next_cursor: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        batches = []
        for batches_item_data in self.batches:
            batches_item = batches_item_data.to_dict()
            batches.append(batches_item)

        has_more = self.has_more

        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "batches": batches,
            }
        )
        if has_more is not UNSET:
            field_dict["hasMore"] = has_more
        if next_cursor is not UNSET:
            field_dict["nextCursor"] = next_cursor

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_simulation_runs_batches_list_response_200_batches_item import (
            GetApiSimulationRunsBatchesListResponse200BatchesItem,
        )

        d = dict(src_dict)
        batches = []
        _batches = d.pop("batches")
        for batches_item_data in _batches:
            batches_item = GetApiSimulationRunsBatchesListResponse200BatchesItem.from_dict(batches_item_data)

            batches.append(batches_item)

        has_more = d.pop("hasMore", UNSET)

        next_cursor = d.pop("nextCursor", UNSET)

        get_api_simulation_runs_batches_list_response_200 = cls(
            batches=batches,
            has_more=has_more,
            next_cursor=next_cursor,
        )

        get_api_simulation_runs_batches_list_response_200.additional_properties = d
        return get_api_simulation_runs_batches_list_response_200

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
