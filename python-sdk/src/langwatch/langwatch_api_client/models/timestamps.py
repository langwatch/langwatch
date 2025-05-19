from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="Timestamps")


@_attrs_define
class Timestamps:
    """
    Attributes:
        inserted_at (Union[Unset, int]):
        started_at (Union[Unset, int]):
        updated_at (Union[Unset, int]):
    """

    inserted_at: Union[Unset, int] = UNSET
    started_at: Union[Unset, int] = UNSET
    updated_at: Union[Unset, int] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        inserted_at = self.inserted_at

        started_at = self.started_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if inserted_at is not UNSET:
            field_dict["inserted_at"] = inserted_at
        if started_at is not UNSET:
            field_dict["started_at"] = started_at
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        inserted_at = d.pop("inserted_at", UNSET)

        started_at = d.pop("started_at", UNSET)

        updated_at = d.pop("updated_at", UNSET)

        timestamps = cls(
            inserted_at=inserted_at,
            started_at=started_at,
            updated_at=updated_at,
        )

        timestamps.additional_properties = d
        return timestamps

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
