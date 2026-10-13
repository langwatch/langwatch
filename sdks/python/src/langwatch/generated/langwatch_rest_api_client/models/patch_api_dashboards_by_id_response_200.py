from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

T = TypeVar("T", bound="PatchApiDashboardsByIdResponse200")


@_attrs_define
class PatchApiDashboardsByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        order (int):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        platform_url (str):
    """

    id: str
    name: str
    order: int
    created_at: datetime.datetime
    updated_at: datetime.datetime
    platform_url: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        order = self.order

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "order": order,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
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

        patch_api_dashboards_by_id_response_200 = cls(
            id=id,
            name=name,
            order=order,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        return patch_api_dashboards_by_id_response_200
