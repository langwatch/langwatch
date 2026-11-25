from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_v1_query_reference_response_200_examples_item_requires_gates_item_type_0 import (
    GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType0,
)
from ..models.get_api_v1_query_reference_response_200_examples_item_requires_gates_item_type_1 import (
    GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType1,
)

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200ExamplesItemRequires")


@_attrs_define
class GetApiV1QueryReferenceResponse200ExamplesItemRequires:
    """
    Attributes:
        gates (list[GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType0 |
            GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType1]):
        functions (list[str]):
    """

    gates: list[
        GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType0
        | GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType1
    ]
    functions: list[str]

    def to_dict(self) -> dict[str, Any]:
        gates = []
        for gates_item_data in self.gates:
            gates_item: str
            if isinstance(gates_item_data, GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType0):
                gates_item = gates_item_data.value
            else:
                gates_item = gates_item_data.value

            gates.append(gates_item)

        functions = self.functions

        field_dict: dict[str, Any] = {}

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

            def _parse_gates_item(
                data: object,
            ) -> (
                GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType0
                | GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType1
            ):
                try:
                    if not isinstance(data, str):
                        raise TypeError()
                    gates_item_type_0 = GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType0(data)

                    return gates_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, str):
                    raise TypeError()
                gates_item_type_1 = GetApiV1QueryReferenceResponse200ExamplesItemRequiresGatesItemType1(data)

                return gates_item_type_1

            gates_item = _parse_gates_item(gates_item_data)

            gates.append(gates_item)

        functions = cast(list[str], d.pop("functions"))

        get_api_v1_query_reference_response_200_examples_item_requires = cls(
            gates=gates,
            functions=functions,
        )

        return get_api_v1_query_reference_response_200_examples_item_requires
