from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_v1_query_reference_response_200_lwql_schema_views_item_columns_item_gates_item_type_0 import (
    GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType0,
)
from ..models.get_api_v1_query_reference_response_200_lwql_schema_views_item_columns_item_gates_item_type_1 import (
    GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType1,
)

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItem:
    """
    Attributes:
        name (str):
        type_ (str):
        description (str):
        unit (None | str):
        gates (list[GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType0 |
            GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType1]):
        available (bool):
    """

    name: str
    type_: str
    description: str
    unit: None | str
    gates: list[
        GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType0
        | GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType1
    ]
    available: bool

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        description = self.description

        unit: None | str
        unit = self.unit

        gates = []
        for gates_item_data in self.gates:
            gates_item: str
            if isinstance(
                gates_item_data, GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType0
            ):
                gates_item = gates_item_data.value
            else:
                gates_item = gates_item_data.value

            gates.append(gates_item)

        available = self.available

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
                "description": description,
                "unit": unit,
                "gates": gates,
                "available": available,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = d.pop("type")

        description = d.pop("description")

        def _parse_unit(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        unit = _parse_unit(d.pop("unit"))

        gates = []
        _gates = d.pop("gates")
        for gates_item_data in _gates:

            def _parse_gates_item(
                data: object,
            ) -> (
                GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType0
                | GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType1
            ):
                try:
                    if not isinstance(data, str):
                        raise TypeError()
                    gates_item_type_0 = GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType0(
                        data
                    )

                    return gates_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, str):
                    raise TypeError()
                gates_item_type_1 = GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItemGatesItemType1(data)

                return gates_item_type_1

            gates_item = _parse_gates_item(gates_item_data)

            gates.append(gates_item)

        available = d.pop("available")

        get_api_v1_query_reference_response_200_lwql_schema_views_item_columns_item = cls(
            name=name,
            type_=type_,
            description=description,
            unit=unit,
            gates=gates,
            available=available,
        )

        return get_api_v1_query_reference_response_200_lwql_schema_views_item_columns_item
