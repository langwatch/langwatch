from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_v1_query_reference_response_200_lwql_schema_views_item_columns_item import (
        GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItem,
    )


T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200LwqlSchemaViewsItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200LwqlSchemaViewsItem:
    """
    Attributes:
        name (str):
        description (str):
        grain (str):
        join_keys (list[str]):
        time_column (None | str):
        freshness (str):
        columns (list[GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItem]):
        example_sql (str):
    """

    name: str
    description: str
    grain: str
    join_keys: list[str]
    time_column: None | str
    freshness: str
    columns: list[GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItem]
    example_sql: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        grain = self.grain

        join_keys = self.join_keys

        time_column: None | str
        time_column = self.time_column

        freshness = self.freshness

        columns = []
        for columns_item_data in self.columns:
            columns_item = columns_item_data.to_dict()
            columns.append(columns_item)

        example_sql = self.example_sql

        field_dict: dict[str, Any] = {}

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
        from ..models.get_api_v1_query_reference_response_200_lwql_schema_views_item_columns_item import (
            GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description")

        grain = d.pop("grain")

        join_keys = cast(list[str], d.pop("joinKeys"))

        def _parse_time_column(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        time_column = _parse_time_column(d.pop("timeColumn"))

        freshness = d.pop("freshness")

        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = GetApiV1QueryReferenceResponse200LwqlSchemaViewsItemColumnsItem.from_dict(columns_item_data)

            columns.append(columns_item)

        example_sql = d.pop("exampleSql")

        get_api_v1_query_reference_response_200_lwql_schema_views_item = cls(
            name=name,
            description=description,
            grain=grain,
            join_keys=join_keys,
            time_column=time_column,
            freshness=freshness,
            columns=columns,
            example_sql=example_sql,
        )

        return get_api_v1_query_reference_response_200_lwql_schema_views_item
