from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsResponse201")


@_attrs_define
class PostApiScenarioEventsResponse201:
    """
    Attributes:
        success (bool):
        url (None | str | Unset):
    """

    success: bool
    url: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        url: None | str | Unset
        if isinstance(self.url, Unset):
            url = UNSET
        else:
            url = self.url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "success": success,
            }
        )
        if url is not UNSET:
            field_dict["url"] = url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        success = d.pop("success")

        def _parse_url(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        url = _parse_url(d.pop("url", UNSET))

        post_api_scenario_events_response_201 = cls(
            success=success,
            url=url,
        )

        return post_api_scenario_events_response_201
