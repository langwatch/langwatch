from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="GetApiDashboardsResponse200DataItem")


@_attrs_define
class GetApiDashboardsResponse200DataItem:
    """
    Attributes:
        id (str):
        name (str):
        order (int):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        platform_url (str):
        graph_count (int):
    """

    id: str
    name: str
    order: int
    created_at: datetime.datetime
    updated_at: datetime.datetime
    platform_url: str
    graph_count: int

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        order = self.order

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        platform_url = self.platform_url

        graph_count = self.graph_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "order": order,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
                "graphCount": graph_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        order = d.pop("order")

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

        platform_url = d.pop("platformUrl")

        graph_count = d.pop("graphCount")

        get_api_dashboards_response_200_data_item = cls(
            id=id,
            name=name,
            order=order,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
            graph_count=graph_count,
        )

        return get_api_dashboards_response_200_data_item
