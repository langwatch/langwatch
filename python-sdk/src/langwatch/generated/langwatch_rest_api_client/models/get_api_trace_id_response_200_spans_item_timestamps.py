from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200SpansItemTimestamps")


@_attrs_define
class GetApiTraceIdResponse200SpansItemTimestamps:
    """
    Attributes:
        finished_at (Union[Unset, int]):  Example: 1721382488392.
        updated_at (Union[Unset, int]):  Example: 1721382492027.
        started_at (Union[Unset, int]):  Example: 1721382486895.
        first_token_at (Union[Unset, int]):  Example: 1721382488317.
        inserted_at (Union[Unset, int]):  Example: 1721382492027.
    """

    finished_at: Union[Unset, int] = UNSET
    updated_at: Union[Unset, int] = UNSET
    started_at: Union[Unset, int] = UNSET
    first_token_at: Union[Unset, int] = UNSET
    inserted_at: Union[Unset, int] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        finished_at = self.finished_at

        updated_at = self.updated_at

        started_at = self.started_at

        first_token_at = self.first_token_at

        inserted_at = self.inserted_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if finished_at is not UNSET:
            field_dict["finished_at"] = finished_at
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at
        if started_at is not UNSET:
            field_dict["started_at"] = started_at
        if first_token_at is not UNSET:
            field_dict["first_token_at"] = first_token_at
        if inserted_at is not UNSET:
            field_dict["inserted_at"] = inserted_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        finished_at = d.pop("finished_at", UNSET)

        updated_at = d.pop("updated_at", UNSET)

        started_at = d.pop("started_at", UNSET)

        first_token_at = d.pop("first_token_at", UNSET)

        inserted_at = d.pop("inserted_at", UNSET)

        get_api_trace_id_response_200_spans_item_timestamps = cls(
            finished_at=finished_at,
            updated_at=updated_at,
            started_at=started_at,
            first_token_at=first_token_at,
            inserted_at=inserted_at,
        )

        get_api_trace_id_response_200_spans_item_timestamps.additional_properties = d
        return get_api_trace_id_response_200_spans_item_timestamps

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
