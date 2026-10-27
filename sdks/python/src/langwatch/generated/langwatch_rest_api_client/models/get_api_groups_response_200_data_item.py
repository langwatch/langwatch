from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.get_api_groups_response_200_data_item_bindings_item import GetApiGroupsResponse200DataItemBindingsItem


T = TypeVar("T", bound="GetApiGroupsResponse200DataItem")


@_attrs_define
class GetApiGroupsResponse200DataItem:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        external_id (None | str):
        scim_source (None | str):
        created_at (datetime.datetime):
        member_count (int):
        bindings (list[GetApiGroupsResponse200DataItemBindingsItem]):
    """

    id: str
    name: str
    slug: str
    external_id: None | str
    scim_source: None | str
    created_at: datetime.datetime
    member_count: int
    bindings: list[GetApiGroupsResponse200DataItemBindingsItem]

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        external_id: None | str
        external_id = self.external_id

        scim_source: None | str
        scim_source = self.scim_source

        created_at = self.created_at.isoformat()

        member_count = self.member_count

        bindings = []
        for bindings_item_data in self.bindings:
            bindings_item = bindings_item_data.to_dict()
            bindings.append(bindings_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "externalId": external_id,
                "scimSource": scim_source,
                "createdAt": created_at,
                "memberCount": member_count,
                "bindings": bindings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_groups_response_200_data_item_bindings_item import (
            GetApiGroupsResponse200DataItemBindingsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        def _parse_external_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        external_id = _parse_external_id(d.pop("externalId"))

        def _parse_scim_source(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        scim_source = _parse_scim_source(d.pop("scimSource"))

        created_at = isoparse(d.pop("createdAt"))

        member_count = d.pop("memberCount")

        bindings = []
        _bindings = d.pop("bindings")
        for bindings_item_data in _bindings:
            bindings_item = GetApiGroupsResponse200DataItemBindingsItem.from_dict(bindings_item_data)

            bindings.append(bindings_item)

        get_api_groups_response_200_data_item = cls(
            id=id,
            name=name,
            slug=slug,
            external_id=external_id,
            scim_source=scim_source,
            created_at=created_at,
            member_count=member_count,
            bindings=bindings,
        )

        return get_api_groups_response_200_data_item
