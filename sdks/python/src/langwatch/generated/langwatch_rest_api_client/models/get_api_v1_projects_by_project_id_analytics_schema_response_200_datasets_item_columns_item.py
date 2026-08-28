from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item_gates_item import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemGatesItem,
)
from ..models.get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item_unit_type_1 import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType1,
)
from ..models.get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item_unit_type_2_type_1 import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType2Type1,
)
from ..models.get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item_unit_type_3_type_1 import (
    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType3Type1,
)

T = TypeVar("T", bound="GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItem")


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItem:
    """
    Attributes:
        name (str):
        type_ (str):
        description (str):
        unit (GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType1 |
            GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType2Type1 |
            GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType3Type1 | None):
        gates (list[GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemGatesItem]):
        available (bool):
    """

    name: str
    type_: str
    description: str
    unit: (
        GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType1
        | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType2Type1
        | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType3Type1
        | None
    )
    gates: list[GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemGatesItem]
    available: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        description = self.description

        unit: None | str
        if isinstance(self.unit, GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType1):
            unit = self.unit.value
        elif isinstance(
            self.unit, GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType2Type1
        ):
            unit = self.unit.value
        elif isinstance(
            self.unit, GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType3Type1
        ):
            unit = self.unit.value
        else:
            unit = self.unit

        gates = []
        for gates_item_data in self.gates:
            gates_item = gates_item_data.value
            gates.append(gates_item)

        available = self.available

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        def _parse_unit(
            data: object,
        ) -> (
            GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType1
            | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType2Type1
            | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType3Type1
            | None
        ):
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                unit_type_1 = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType1(
                    data
                )

                return unit_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                unit_type_2_type_1 = (
                    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType2Type1(data)
                )

                return unit_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                unit_type_3_type_1 = (
                    GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType3Type1(data)
                )

                return unit_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType1
                | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType2Type1
                | GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemUnitType3Type1
                | None,
                data,
            )

        unit = _parse_unit(d.pop("unit"))

        gates = []
        _gates = d.pop("gates")
        for gates_item_data in _gates:
            gates_item = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItemGatesItem(
                gates_item_data
            )

            gates.append(gates_item)

        available = d.pop("available")

        get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item = cls(
            name=name,
            type_=type_,
            description=description,
            unit=unit,
            gates=gates,
            available=available,
        )

        get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item.additional_properties = d
        return get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item

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
