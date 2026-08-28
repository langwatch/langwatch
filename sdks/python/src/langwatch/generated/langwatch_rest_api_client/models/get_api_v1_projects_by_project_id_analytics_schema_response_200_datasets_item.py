from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item import (
        GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItem,
    )


T = TypeVar("T", bound="GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItem")


@_attrs_define
class GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItem:
    """
    Attributes:
        name (str):
        description (str):
        grain (str):
        join_keys (list[str]):
        time_column (str):
        freshness (str):
        columns (list[GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItem]):
        example_sql (str):
    """

    name: str
    description: str
    grain: str
    join_keys: list[str]
    time_column: str
    freshness: str
    columns: list[GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItem]
    example_sql: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        grain = self.grain

        join_keys = self.join_keys

        time_column = self.time_column

        freshness = self.freshness

        columns = []
        for columns_item_data in self.columns:
            columns_item = columns_item_data.to_dict()
            columns.append(columns_item)

        example_sql = self.example_sql

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "description": description,
                "grain": grain,
                "joinKeys": join_keys,
                "timeColumn": time_column,
                "freshness": freshness,
                "columns": columns,
                "exampleSql": example_sql,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item_columns_item import (
            GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description")

        grain = d.pop("grain")

        join_keys = cast(list[str], d.pop("joinKeys"))

        time_column = d.pop("timeColumn")

        freshness = d.pop("freshness")

        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = GetApiV1ProjectsByProjectIdAnalyticsSchemaResponse200DatasetsItemColumnsItem.from_dict(
                columns_item_data
            )

            columns.append(columns_item)

        example_sql = d.pop("exampleSql")

        get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item = cls(
            name=name,
            description=description,
            grain=grain,
            join_keys=join_keys,
            time_column=time_column,
            freshness=freshness,
            columns=columns,
            example_sql=example_sql,
        )

        get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item.additional_properties = d
        return get_api_v1_projects_by_project_id_analytics_schema_response_200_datasets_item

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
