from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200EvaluationsItemTimestamps")


@_attrs_define
class GetApiTraceIdResponse200EvaluationsItemTimestamps:
    """
    Attributes:
        updated_at (Union[Unset, int]):  Example: 1721383657788.
        inserted_at (Union[Unset, int]):  Example: 1721382493358.
    """

    updated_at: Union[Unset, int] = UNSET
    inserted_at: Union[Unset, int] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        updated_at = self.updated_at

        inserted_at = self.inserted_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at
        if inserted_at is not UNSET:
            field_dict["inserted_at"] = inserted_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        updated_at = d.pop("updated_at", UNSET)

        inserted_at = d.pop("inserted_at", UNSET)

        get_api_trace_id_response_200_evaluations_item_timestamps = cls(
            updated_at=updated_at,
            inserted_at=inserted_at,
        )

        get_api_trace_id_response_200_evaluations_item_timestamps.additional_properties = d
        return get_api_trace_id_response_200_evaluations_item_timestamps

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
