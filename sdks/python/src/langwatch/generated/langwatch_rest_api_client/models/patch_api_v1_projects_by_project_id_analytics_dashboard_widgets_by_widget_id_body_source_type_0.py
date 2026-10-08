from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodySourceType0")


@_attrs_define
class PatchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdBodySourceType0:
    """
    Attributes:
        kind (Literal['catalogue']):
        catalogue_id (str):
    """

    kind: Literal["catalogue"]
    catalogue_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        catalogue_id = self.catalogue_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "catalogueId": catalogue_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["catalogue"], d.pop("kind"))
        if kind != "catalogue":
            raise ValueError(f"kind must match const 'catalogue', got '{kind}'")

        catalogue_id = d.pop("catalogueId")

        patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body_source_type_0 = cls(
            kind=kind,
            catalogue_id=catalogue_id,
        )

        patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body_source_type_0.additional_properties = d
        return patch_api_v1_projects_by_project_id_analytics_dashboard_widgets_by_widget_id_body_source_type_0

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
