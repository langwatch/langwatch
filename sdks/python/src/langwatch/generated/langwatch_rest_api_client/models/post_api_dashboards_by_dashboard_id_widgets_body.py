from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dashboards_by_dashboard_id_widgets_body_queries_item import (
        PostApiDashboardsByDashboardIdWidgetsBodyQueriesItem,
    )
    from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_0 import (
        PostApiDashboardsByDashboardIdWidgetsBodySourceType0,
    )
    from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_1 import (
        PostApiDashboardsByDashboardIdWidgetsBodySourceType1,
    )
    from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_2 import (
        PostApiDashboardsByDashboardIdWidgetsBodySourceType2,
    )
    from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_3 import (
        PostApiDashboardsByDashboardIdWidgetsBodySourceType3,
    )


T = TypeVar("T", bound="PostApiDashboardsByDashboardIdWidgetsBody")


@_attrs_define
class PostApiDashboardsByDashboardIdWidgetsBody:
    """
    Attributes:
        name (str):
        code (str):
        queries (list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItem]):
        description (str | Unset):
        prompt (str | Unset):
        source (PostApiDashboardsByDashboardIdWidgetsBodySourceType0 |
            PostApiDashboardsByDashboardIdWidgetsBodySourceType1 | PostApiDashboardsByDashboardIdWidgetsBodySourceType2 |
            PostApiDashboardsByDashboardIdWidgetsBodySourceType3 | Unset):
    """

    name: str
    code: str
    queries: list[PostApiDashboardsByDashboardIdWidgetsBodyQueriesItem]
    description: str | Unset = UNSET
    prompt: str | Unset = UNSET
    source: (
        PostApiDashboardsByDashboardIdWidgetsBodySourceType0
        | PostApiDashboardsByDashboardIdWidgetsBodySourceType1
        | PostApiDashboardsByDashboardIdWidgetsBodySourceType2
        | PostApiDashboardsByDashboardIdWidgetsBodySourceType3
        | Unset
    ) = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_0 import (
            PostApiDashboardsByDashboardIdWidgetsBodySourceType0,
        )
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_1 import (
            PostApiDashboardsByDashboardIdWidgetsBodySourceType1,
        )
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_2 import (
            PostApiDashboardsByDashboardIdWidgetsBodySourceType2,
        )

        name = self.name

        code = self.code

        queries = []
        for queries_item_data in self.queries:
            queries_item = queries_item_data.to_dict()
            queries.append(queries_item)

        description = self.description

        prompt = self.prompt

        source: dict[str, Any] | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(self.source, PostApiDashboardsByDashboardIdWidgetsBodySourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, PostApiDashboardsByDashboardIdWidgetsBodySourceType1):
            source = self.source.to_dict()
        elif isinstance(self.source, PostApiDashboardsByDashboardIdWidgetsBodySourceType2):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "code": code,
                "queries": queries,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if prompt is not UNSET:
            field_dict["prompt"] = prompt
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_queries_item import (
            PostApiDashboardsByDashboardIdWidgetsBodyQueriesItem,
        )
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_0 import (
            PostApiDashboardsByDashboardIdWidgetsBodySourceType0,
        )
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_1 import (
            PostApiDashboardsByDashboardIdWidgetsBodySourceType1,
        )
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_2 import (
            PostApiDashboardsByDashboardIdWidgetsBodySourceType2,
        )
        from ..models.post_api_dashboards_by_dashboard_id_widgets_body_source_type_3 import (
            PostApiDashboardsByDashboardIdWidgetsBodySourceType3,
        )

        d = dict(src_dict)
        name = d.pop("name")

        code = d.pop("code")

        queries = []
        _queries = d.pop("queries")
        for queries_item_data in _queries:
            queries_item = PostApiDashboardsByDashboardIdWidgetsBodyQueriesItem.from_dict(queries_item_data)

            queries.append(queries_item)

        description = d.pop("description", UNSET)

        prompt = d.pop("prompt", UNSET)

        def _parse_source(
            data: object,
        ) -> (
            PostApiDashboardsByDashboardIdWidgetsBodySourceType0
            | PostApiDashboardsByDashboardIdWidgetsBodySourceType1
            | PostApiDashboardsByDashboardIdWidgetsBodySourceType2
            | PostApiDashboardsByDashboardIdWidgetsBodySourceType3
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = PostApiDashboardsByDashboardIdWidgetsBodySourceType0.from_dict(data)

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = PostApiDashboardsByDashboardIdWidgetsBodySourceType1.from_dict(data)

                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_2 = PostApiDashboardsByDashboardIdWidgetsBodySourceType2.from_dict(data)

                return source_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_3 = PostApiDashboardsByDashboardIdWidgetsBodySourceType3.from_dict(data)

            return source_type_3

        source = _parse_source(d.pop("source", UNSET))

        post_api_dashboards_by_dashboard_id_widgets_body = cls(
            name=name,
            code=code,
            queries=queries,
            description=description,
            prompt=prompt,
            source=source,
        )

        post_api_dashboards_by_dashboard_id_widgets_body.additional_properties = d
        return post_api_dashboards_by_dashboard_id_widgets_body

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
