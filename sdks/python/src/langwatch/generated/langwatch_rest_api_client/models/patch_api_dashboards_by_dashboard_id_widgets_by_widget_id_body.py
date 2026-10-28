from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_queries_item import (
        PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodyQueriesItem,
    )
    from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_0 import (
        PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType0,
    )
    from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_1 import (
        PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType1,
    )
    from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_2 import (
        PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType2,
    )
    from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_3 import (
        PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType3,
    )


T = TypeVar("T", bound="PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody")


@_attrs_define
class PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBody:
    """
    Attributes:
        name (str | Unset):
        code (str | Unset):
        queries (list[PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodyQueriesItem] | Unset):
        description (str | Unset):
        source (PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType0 |
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType1 |
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType2 |
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType3 | Unset):
        excluded_origins (list[str] | None | Unset):
    """

    name: str | Unset = UNSET
    code: str | Unset = UNSET
    queries: list[PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodyQueriesItem] | Unset = UNSET
    description: str | Unset = UNSET
    source: (
        PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType0
        | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType1
        | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType2
        | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType3
        | Unset
    ) = UNSET
    excluded_origins: list[str] | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_0 import (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType0,
        )
        from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_1 import (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType1,
        )
        from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_2 import (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType2,
        )

        name = self.name

        code = self.code

        queries: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.queries, Unset):
            queries = []
            for queries_item_data in self.queries:
                queries_item = queries_item_data.to_dict()
                queries.append(queries_item)

        description = self.description

        source: dict[str, Any] | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(self.source, PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType1):
            source = self.source.to_dict()
        elif isinstance(self.source, PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType2):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()

        excluded_origins: list[str] | None | Unset
        if isinstance(self.excluded_origins, Unset):
            excluded_origins = UNSET
        elif isinstance(self.excluded_origins, list):
            excluded_origins = self.excluded_origins

        else:
            excluded_origins = self.excluded_origins

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if code is not UNSET:
            field_dict["code"] = code
        if queries is not UNSET:
            field_dict["queries"] = queries
        if description is not UNSET:
            field_dict["description"] = description
        if source is not UNSET:
            field_dict["source"] = source
        if excluded_origins is not UNSET:
            field_dict["excludedOrigins"] = excluded_origins

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_queries_item import (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodyQueriesItem,
        )
        from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_0 import (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType0,
        )
        from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_1 import (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType1,
        )
        from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_2 import (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType2,
        )
        from ..models.patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body_source_type_3 import (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType3,
        )

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        code = d.pop("code", UNSET)

        _queries = d.pop("queries", UNSET)
        queries: list[PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodyQueriesItem] | Unset = UNSET
        if _queries is not UNSET:
            queries = []
            for queries_item_data in _queries:
                queries_item = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodyQueriesItem.from_dict(
                    queries_item_data
                )

                queries.append(queries_item)

        description = d.pop("description", UNSET)

        def _parse_source(
            data: object,
        ) -> (
            PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType0
            | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType1
            | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType2
            | PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType3
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType0.from_dict(data)

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType1.from_dict(data)

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_2 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType2.from_dict(data)

                return source_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_3 = PatchApiDashboardsByDashboardIdWidgetsByWidgetIdBodySourceType3.from_dict(data)

            return source_type_3

        source = _parse_source(d.pop("source", UNSET))

        def _parse_excluded_origins(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                excluded_origins_type_0 = cast(list[str], data)

                return excluded_origins_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        excluded_origins = _parse_excluded_origins(d.pop("excludedOrigins", UNSET))

        patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body = cls(
            name=name,
            code=code,
            queries=queries,
            description=description,
            source=source,
            excluded_origins=excluded_origins,
        )

        patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body.additional_properties = d
        return patch_api_dashboards_by_dashboard_id_widgets_by_widget_id_body

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
