from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTriggersByIdResponse200ReportType0SourceType0")


@_attrs_define
class GetApiTriggersByIdResponse200ReportType0SourceType0:
    """
    Attributes:
        kind (Literal['dashboard']):
        dashboard_id (str):
    """

    kind: Literal["dashboard"]
    dashboard_id: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        dashboard_id = self.dashboard_id

        field_dict: dict[str, Any] = {}

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

        get_api_triggers_by_id_response_200_report_type_0_source_type_0 = cls(
            kind=kind,
            dashboard_id=dashboard_id,
        )

        return get_api_triggers_by_id_response_200_report_type_0_source_type_0
