from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiTriggersByIdEnableResponse200ReportType0SourceType0")


@_attrs_define
class PostApiTriggersByIdEnableResponse200ReportType0SourceType0:
    """
    Attributes:
        kind (Literal['dashboard']):
        dashboard_id (str):
    """

    kind: Literal["dashboard"]
    dashboard_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        dashboard_id = self.dashboard_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "dashboardId": dashboard_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["dashboard"], d.pop("kind"))
        if kind != "dashboard":
            raise ValueError(f"kind must match const 'dashboard', got '{kind}'")

        dashboard_id = d.pop("dashboardId")

        post_api_triggers_by_id_enable_response_200_report_type_0_source_type_0 = cls(
            kind=kind,
            dashboard_id=dashboard_id,
        )

        post_api_triggers_by_id_enable_response_200_report_type_0_source_type_0.additional_properties = d
        return post_api_triggers_by_id_enable_response_200_report_type_0_source_type_0

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
