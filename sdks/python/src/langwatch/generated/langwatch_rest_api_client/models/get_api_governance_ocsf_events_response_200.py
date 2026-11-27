from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_governance_ocsf_events_response_200_data_item import (
        GetApiGovernanceOcsfEventsResponse200DataItem,
    )


T = TypeVar("T", bound="GetApiGovernanceOcsfEventsResponse200")


@_attrs_define
class GetApiGovernanceOcsfEventsResponse200:
    """
    Attributes:
        ocsf_version (str):
        data (list[GetApiGovernanceOcsfEventsResponse200DataItem]):
        next_cursor (str):
        has_more (bool):
    """

    ocsf_version: str
    data: list[GetApiGovernanceOcsfEventsResponse200DataItem]
    next_cursor: str
    has_more: bool

    def to_dict(self) -> dict[str, Any]:
        ocsf_version = self.ocsf_version

        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        next_cursor = self.next_cursor

        has_more = self.has_more

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ocsf_version": ocsf_version,
                "data": data,
                "next_cursor": next_cursor,
                "has_more": has_more,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_ocsf_events_response_200_data_item import (
            GetApiGovernanceOcsfEventsResponse200DataItem,
        )

        d = dict(src_dict)
        ocsf_version = d.pop("ocsf_version")

        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = GetApiGovernanceOcsfEventsResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        next_cursor = d.pop("next_cursor")

        has_more = d.pop("has_more")

        get_api_governance_ocsf_events_response_200 = cls(
            ocsf_version=ocsf_version,
            data=data,
            next_cursor=next_cursor,
            has_more=has_more,
        )

        return get_api_governance_ocsf_events_response_200
