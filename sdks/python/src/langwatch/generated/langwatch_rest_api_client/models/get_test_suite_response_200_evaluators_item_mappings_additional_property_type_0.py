from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_test_suite_response_200_evaluators_item_mappings_additional_property_type_0_source_id import (
    GetTestSuiteResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId,
)

T = TypeVar("T", bound="GetTestSuiteResponse200EvaluatorsItemMappingsAdditionalPropertyType0")


@_attrs_define
class GetTestSuiteResponse200EvaluatorsItemMappingsAdditionalPropertyType0:
    """
    Attributes:
        type_ (Literal['source']):
        source_id (GetTestSuiteResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId):
        path (list[str]):
    """

    type_: Literal["source"]
    source_id: GetTestSuiteResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId
    path: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        source_id = self.source_id.value

        path = self.path

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "sourceId": source_id,
                "path": path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["source"], d.pop("type"))
        if type_ != "source":
            raise ValueError(f"type must match const 'source', got '{type_}'")

        source_id = GetTestSuiteResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId(d.pop("sourceId"))

        path = cast(list[str], d.pop("path"))

        get_test_suite_response_200_evaluators_item_mappings_additional_property_type_0 = cls(
            type_=type_,
            source_id=source_id,
            path=path,
        )

        get_test_suite_response_200_evaluators_item_mappings_additional_property_type_0.additional_properties = d
        return get_test_suite_response_200_evaluators_item_mappings_additional_property_type_0

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
