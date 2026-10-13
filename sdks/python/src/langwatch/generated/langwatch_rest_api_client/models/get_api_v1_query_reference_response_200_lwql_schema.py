from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_v1_query_reference_response_200_lwql_schema_app_functions_item import (
        GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItem,
    )
    from ..models.get_api_v1_query_reference_response_200_lwql_schema_views_item import (
        GetApiV1QueryReferenceResponse200LwqlSchemaViewsItem,
    )


T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200LwqlSchema")


@_attrs_define
class GetApiV1QueryReferenceResponse200LwqlSchema:
    """
    Attributes:
        database (str):
        functions (list[str]):
        views (list[GetApiV1QueryReferenceResponse200LwqlSchemaViewsItem]):
        app_functions (list[GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItem]):
    """

    database: str
    functions: list[str]
    views: list[GetApiV1QueryReferenceResponse200LwqlSchemaViewsItem]
    app_functions: list[GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItem]

    def to_dict(self) -> dict[str, Any]:
        database = self.database

        functions = self.functions

        views = []
        for views_item_data in self.views:
            views_item = views_item_data.to_dict()
            views.append(views_item)

        app_functions = []
        for app_functions_item_data in self.app_functions:
            app_functions_item = app_functions_item_data.to_dict()
            app_functions.append(app_functions_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "database": database,
                "functions": functions,
                "views": views,
                "appFunctions": app_functions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_query_reference_response_200_lwql_schema_app_functions_item import (
            GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItem,
        )
        from ..models.get_api_v1_query_reference_response_200_lwql_schema_views_item import (
            GetApiV1QueryReferenceResponse200LwqlSchemaViewsItem,
        )

        d = dict(src_dict)
        database = d.pop("database")

        functions = cast(list[str], d.pop("functions"))

        views = []
        _views = d.pop("views")
        for views_item_data in _views:
            views_item = GetApiV1QueryReferenceResponse200LwqlSchemaViewsItem.from_dict(views_item_data)

            views.append(views_item)

        app_functions = []
        _app_functions = d.pop("appFunctions")
        for app_functions_item_data in _app_functions:
            app_functions_item = GetApiV1QueryReferenceResponse200LwqlSchemaAppFunctionsItem.from_dict(
                app_functions_item_data
            )

            app_functions.append(app_functions_item)

        get_api_v1_query_reference_response_200_lwql_schema = cls(
            database=database,
            functions=functions,
            views=views,
            app_functions=app_functions,
        )

        return get_api_v1_query_reference_response_200_lwql_schema
