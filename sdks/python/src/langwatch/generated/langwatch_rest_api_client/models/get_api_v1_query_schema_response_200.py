from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_query_schema_response_200_app_functions_item import (
        GetApiV1QuerySchemaResponse200AppFunctionsItem,
    )
    from ..models.get_api_v1_query_schema_response_200_views_item import GetApiV1QuerySchemaResponse200ViewsItem


T = TypeVar("T", bound="GetApiV1QuerySchemaResponse200")


@_attrs_define
class GetApiV1QuerySchemaResponse200:
    """
    Attributes:
        database (str):
        views (list[GetApiV1QuerySchemaResponse200ViewsItem]):
        functions (list[str]):
        app_functions (list[GetApiV1QuerySchemaResponse200AppFunctionsItem]):
    """

    database: str
    views: list[GetApiV1QuerySchemaResponse200ViewsItem]
    functions: list[str]
    app_functions: list[GetApiV1QuerySchemaResponse200AppFunctionsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        database = self.database

        views = []
        for views_item_data in self.views:
            views_item = views_item_data.to_dict()
            views.append(views_item)

        functions = self.functions

        app_functions = []
        for app_functions_item_data in self.app_functions:
            app_functions_item = app_functions_item_data.to_dict()
            app_functions.append(app_functions_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "database": database,
                "views": views,
                "functions": functions,
                "appFunctions": app_functions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_query_schema_response_200_app_functions_item import (
            GetApiV1QuerySchemaResponse200AppFunctionsItem,
        )
        from ..models.get_api_v1_query_schema_response_200_views_item import GetApiV1QuerySchemaResponse200ViewsItem

        d = dict(src_dict)
        database = d.pop("database")

        views = []
        _views = d.pop("views")
        for views_item_data in _views:
            views_item = GetApiV1QuerySchemaResponse200ViewsItem.from_dict(views_item_data)

            views.append(views_item)

        functions = cast(list[str], d.pop("functions"))

        app_functions = []
        _app_functions = d.pop("appFunctions")
        for app_functions_item_data in _app_functions:
            app_functions_item = GetApiV1QuerySchemaResponse200AppFunctionsItem.from_dict(app_functions_item_data)

            app_functions.append(app_functions_item)

        get_api_v1_query_schema_response_200 = cls(
            database=database,
            views=views,
            functions=functions,
            app_functions=app_functions,
        )

        get_api_v1_query_schema_response_200.additional_properties = d
        return get_api_v1_query_schema_response_200

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
