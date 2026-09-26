from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_v1_query_reference_response_200_lwql_schema_app_functions_item_encoding import (
    GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemEncoding,
)
from ..models.get_api_v1_query_reference_response_200_lwql_schema_app_functions_item_gates_item import (
    GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemGatesItem,
)
from ..models.get_api_v1_query_reference_response_200_lwql_schema_app_functions_item_key_kind import (
    GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKeyKind,
)
from ..models.get_api_v1_query_reference_response_200_lwql_schema_app_functions_item_kind import (
    GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKind,
)

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItem:
    """
    Attributes:
        name (str):
        signature (str):
        description (str):
        kind (GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKind):
        returns (str):
        encoding (GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemEncoding):
        key_kind (GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKeyKind):
        cap (int):
        gates (list[GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemGatesItem]):
        available (bool):
        example_sql (str):
    """

    name: str
    signature: str
    description: str
    kind: GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKind
    returns: str
    encoding: GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemEncoding
    key_kind: GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKeyKind
    cap: int
    gates: list[GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemGatesItem]
    available: bool
    example_sql: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        signature = self.signature

        description = self.description

        kind = self.kind.value

        returns = self.returns

        encoding = self.encoding.value

        key_kind = self.key_kind.value

        cap = self.cap

        gates = []
        for gates_item_data in self.gates:
            gates_item = gates_item_data.value
            gates.append(gates_item)

        available = self.available

        example_sql = self.example_sql

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "signature": signature,
                "description": description,
                "kind": kind,
                "returns": returns,
                "encoding": encoding,
                "keyKind": key_kind,
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

        kind = GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKind(d.pop("kind"))

        returns = d.pop("returns")

        encoding = GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemEncoding(d.pop("encoding"))

        key_kind = GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemKeyKind(d.pop("keyKind"))

        cap = d.pop("cap")

        gates = []
        _gates = d.pop("gates")
        for gates_item_data in _gates:
            gates_item = GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItemGatesItem(gates_item_data)

            gates.append(gates_item)

        available = d.pop("available")

        example_sql = d.pop("exampleSql")

        get_api_v1_query_reference_response_200_lwql_schema_app_functions_item = cls(
            name=name,
            signature=signature,
            description=description,
            kind=kind,
            returns=returns,
            encoding=encoding,
            key_kind=key_kind,
            cap=cap,
            gates=gates,
            available=available,
            example_sql=example_sql,
        )

        get_api_v1_query_reference_response_200_lwql_schema_app_functions_item.additional_properties = d
        return get_api_v1_query_reference_response_200_lwql_schema_app_functions_item

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
