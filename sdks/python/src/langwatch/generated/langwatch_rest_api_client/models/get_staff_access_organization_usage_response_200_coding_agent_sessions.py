from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetStaffAccessOrganizationUsageResponse200CodingAgentSessions")


@_attrs_define
class GetStaffAccessOrganizationUsageResponse200CodingAgentSessions:
    """
    Attributes:
        last_7_days (int):
        last_30_days (int):
        last_session_at (None | str):
    """

    last_7_days: int
    last_30_days: int
    last_session_at: None | str

    def to_dict(self) -> dict[str, Any]:
        last_7_days = self.last_7_days

        last_30_days = self.last_30_days

        last_session_at: None | str
        last_session_at = self.last_session_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "last7Days": last_7_days,
                "last30Days": last_30_days,
                "lastSessionAt": last_session_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        last_7_days = d.pop("last7Days")

        last_30_days = d.pop("last30Days")

        def _parse_last_session_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_session_at = _parse_last_session_at(d.pop("lastSessionAt"))

        get_staff_access_organization_usage_response_200_coding_agent_sessions = cls(
            last_7_days=last_7_days,
            last_30_days=last_30_days,
            last_session_at=last_session_at,
        )

        return get_staff_access_organization_usage_response_200_coding_agent_sessions
