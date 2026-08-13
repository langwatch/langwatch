from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PutApiDashboardsReorderBody")


@_attrs_define
class PutApiDashboardsReorderBody:
    """
    Attributes:
        dashboard_ids (list[str]):
    """

    dashboard_ids: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        dashboard_ids = self.dashboard_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "dashboardIds": dashboard_ids,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        dashboard_ids = cast(list[str], d.pop("dashboardIds"))

        put_api_dashboards_reorder_body = cls(
            dashboard_ids=dashboard_ids,
        )

        put_api_dashboards_reorder_body.additional_properties = d
        return put_api_dashboards_reorder_body

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
