from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBodySourceType2")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsBodySourceType2:
    """
    Attributes:
        kind (Literal['code']):
    """

    kind: Literal["code"]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["code"], d.pop("kind"))
        if kind != "code":
            raise ValueError(f"kind must match const 'code', got '{kind}'")

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body_source_type_2 = cls(
            kind=kind,
        )

        post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body_source_type_2.additional_properties = d
        return post_api_v1_projects_by_project_id_analytics_dashboard_widgets_body_source_type_2

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
