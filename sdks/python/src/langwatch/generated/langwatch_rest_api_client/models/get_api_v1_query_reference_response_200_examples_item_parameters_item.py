from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200ExamplesItemParametersItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200ExamplesItemParametersItem:
    """
    Attributes:
        name (str):
        type_ (str):
        description (str):
    """

    name: str
    type_: str
    description: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        description = self.description

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "type": type_,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = d.pop("type")

        description = d.pop("description")

        get_api_v1_query_reference_response_200_examples_item_parameters_item = cls(
            name=name,
            type_=type_,
            description=description,
        )

        get_api_v1_query_reference_response_200_examples_item_parameters_item.additional_properties = d
        return get_api_v1_query_reference_response_200_examples_item_parameters_item

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
