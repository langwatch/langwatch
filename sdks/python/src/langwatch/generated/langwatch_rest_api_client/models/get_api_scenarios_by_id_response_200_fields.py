from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiScenariosByIdResponse200Fields")


@_attrs_define
class GetApiScenariosByIdResponse200Fields:
    """The value this scenario carries for each field its test suite declares, keyed by field identifier. A field with no
    value has no key. Absent on servers that predate suite fields.

    """

    additional_properties: dict[str, bool | float | str] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        get_api_scenarios_by_id_response_200_fields = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(data: object) -> bool | float | str:
                return cast(bool | float | str, data)

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        get_api_scenarios_by_id_response_200_fields.additional_properties = additional_properties
        return get_api_scenarios_by_id_response_200_fields

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> bool | float | str:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: bool | float | str) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
