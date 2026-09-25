from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetTestSuiteResponse200EvaluatorsItemMappingsAdditionalPropertyType1")


@_attrs_define
class GetTestSuiteResponse200EvaluatorsItemMappingsAdditionalPropertyType1:
    """
    Attributes:
        type_ (Literal['value']):
        value (str):
    """

    type_: Literal["value"]
    value: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        value = self.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["value"], d.pop("type"))
        if type_ != "value":
            raise ValueError(f"type must match const 'value', got '{type_}'")

        value = d.pop("value")

        get_test_suite_response_200_evaluators_item_mappings_additional_property_type_1 = cls(
            type_=type_,
            value=value,
        )

        get_test_suite_response_200_evaluators_item_mappings_additional_property_type_1.additional_properties = d
        return get_test_suite_response_200_evaluators_item_mappings_additional_property_type_1

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
