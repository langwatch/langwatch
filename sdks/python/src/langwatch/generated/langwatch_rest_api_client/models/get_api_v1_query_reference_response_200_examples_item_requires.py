from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_v1_query_reference_response_200_examples_item_requires_gates_item import (
    GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItem,
)

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200ExamplesItemRequires")


@_attrs_define
class GetApiV1QueryReferenceResponse200ExamplesItemRequires:
    """
    Attributes:
        gates (list[GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItem]):
        functions (list[str]):
    """

    gates: list[GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItem]
    functions: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        gates = []
        for gates_item_data in self.gates:
            gates_item = gates_item_data.value
            gates.append(gates_item)

        functions = self.functions

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "gates": gates,
                "functions": functions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        gates = []
        _gates = d.pop("gates")
        for gates_item_data in _gates:
            gates_item = GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItem(gates_item_data)

            gates.append(gates_item)

        functions = cast(list[str], d.pop("functions"))

        get_api_v1_query_reference_response_200_examples_item_requires = cls(
            gates=gates,
            functions=functions,
        )

        get_api_v1_query_reference_response_200_examples_item_requires.additional_properties = d
        return get_api_v1_query_reference_response_200_examples_item_requires

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
