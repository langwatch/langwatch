from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetStaffAccessOrganizationUsageResponse200ApiKeysItem")


@_attrs_define
class GetStaffAccessOrganizationUsageResponse200ApiKeysItem:
    """
    Attributes:
        id (str):
        name (str):
        last_used_at (None | str):
    """

    id: str
    name: str
    last_used_at: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        last_used_at: None | str
        last_used_at = self.last_used_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "lastUsedAt": last_used_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_last_used_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_used_at = _parse_last_used_at(d.pop("lastUsedAt"))

        get_staff_access_organization_usage_response_200_api_keys_item = cls(
            id=id,
            name=name,
            last_used_at=last_used_at,
        )

        return get_staff_access_organization_usage_response_200_api_keys_item
