from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_v1_query_schema_response_200_app_functions_item_gates_item_type_0 import (
    GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType0,
)
from ..models.get_api_v1_query_schema_response_200_app_functions_item_gates_item_type_1 import (
    GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType1,
)
from ..models.get_api_v1_query_schema_response_200_app_functions_item_kind import (
    GetApiV1QuerySchemaResponse200AppFunctionsItemKind,
)

T = TypeVar("T", bound="GetApiV1QuerySchemaResponse200AppFunctionsItem")


@_attrs_define
class GetApiV1QuerySchemaResponse200AppFunctionsItem:
    """
    Attributes:
        name (str):
        signature (str):
        description (str):
        returns (str):
        encoding (str):
        key_kind (str):
        kind (GetApiV1QuerySchemaResponse200AppFunctionsItemKind):
        cap (int):
        gates (list[GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType0 |
            GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType1]):
        available (bool):
        example_sql (str):
    """

    name: str
    signature: str
    description: str
    returns: str
    encoding: str
    key_kind: str
    kind: GetApiV1QuerySchemaResponse200AppFunctionsItemKind
    cap: int
    gates: list[
        GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType0
        | GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType1
    ]
    available: bool
    example_sql: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        signature = self.signature

        description = self.description

        returns = self.returns

        encoding = self.encoding

        key_kind = self.key_kind

        kind = self.kind.value

        cap = self.cap

        gates = []
        for gates_item_data in self.gates:
            gates_item: str
            if isinstance(gates_item_data, GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType0):
                gates_item = gates_item_data.value
            else:
                gates_item = gates_item_data.value

            gates.append(gates_item)

        available = self.available

        example_sql = self.example_sql

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "signature": signature,
                "description": description,
                "returns": returns,
                "encoding": encoding,
                "keyKind": key_kind,
                "kind": kind,
                "cap": cap,
                "gates": gates,
                "available": available,
                "exampleSql": example_sql,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        signature = d.pop("signature")

        description = d.pop("description")

        returns = d.pop("returns")

        encoding = d.pop("encoding")

        key_kind = d.pop("keyKind")

        kind = GetApiV1QuerySchemaResponse200AppFunctionsItemKind(d.pop("kind"))

        cap = d.pop("cap")

        gates = []
        _gates = d.pop("gates")
        for gates_item_data in _gates:

            def _parse_gates_item(
                data: object,
            ) -> (
                GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType0
                | GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType1
            ):
                try:
                    if not isinstance(data, str):
                        raise TypeError()
                    gates_item_type_0 = GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType0(data)

                    return gates_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, str):
                    raise TypeError()
                gates_item_type_1 = GetApiV1QuerySchemaResponse200AppFunctionsItemGatesItemType1(data)

                return gates_item_type_1

            gates_item = _parse_gates_item(gates_item_data)

            gates.append(gates_item)

        available = d.pop("available")

        example_sql = d.pop("exampleSql")

        get_api_v1_query_schema_response_200_app_functions_item = cls(
            name=name,
            signature=signature,
            description=description,
            returns=returns,
            encoding=encoding,
            key_kind=key_kind,
            kind=kind,
            cap=cap,
            gates=gates,
            available=available,
            example_sql=example_sql,
        )

        return get_api_v1_query_schema_response_200_app_functions_item
