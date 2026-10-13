from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiTriggersResponse201ReportType0Schedule")


@_attrs_define
class PostApiTriggersResponse201ReportType0Schedule:
    """
    Attributes:
        cron (str):
        timezone (str):
    """

    cron: str
    timezone: str

    def to_dict(self) -> dict[str, Any]:
        cron = self.cron

        timezone = self.timezone

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "cron": cron,
                "timezone": timezone,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        cron = d.pop("cron")

        timezone = d.pop("timezone")

        post_api_triggers_response_201_report_type_0_schedule = cls(
            cron=cron,
            timezone=timezone,
        )

        return post_api_triggers_response_201_report_type_0_schedule
