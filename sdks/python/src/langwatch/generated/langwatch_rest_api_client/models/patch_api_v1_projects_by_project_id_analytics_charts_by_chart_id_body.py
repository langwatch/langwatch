from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdBody")


@_attrs_define
class PatchApiV1ProjectsByProjectIdAnalyticsChartsByChartIdBody:
    """
    Attributes:
        name (str | Unset):
        definition (Any | Unset):
    """

    name: str | Unset = UNSET
    definition: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        definition = self.definition

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if definition is not UNSET:
            field_dict["definition"] = definition

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        definition = d.pop("definition", UNSET)

        patch_api_v1_projects_by_project_id_analytics_charts_by_chart_id_body = cls(
            name=name,
            definition=definition,
        )

        patch_api_v1_projects_by_project_id_analytics_charts_by_chart_id_body.additional_properties = d
        return patch_api_v1_projects_by_project_id_analytics_charts_by_chart_id_body

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
