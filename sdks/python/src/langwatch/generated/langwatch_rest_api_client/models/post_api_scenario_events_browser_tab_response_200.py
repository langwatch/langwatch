from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiScenarioEventsBrowserTabResponse200")


@_attrs_define
class PostApiScenarioEventsBrowserTabResponse200:
    """
    Attributes:
        delivered (bool):
        url (str):
    """

    delivered: bool
    url: str

    def to_dict(self) -> dict[str, Any]:
        delivered = self.delivered

        url = self.url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "delivered": delivered,
                "url": url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        delivered = d.pop("delivered")

        url = d.pop("url")

        post_api_scenario_events_browser_tab_response_200 = cls(
            delivered=delivered,
            url=url,
        )

        return post_api_scenario_events_browser_tab_response_200
