from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_groups_response_200_data_item import GetApiGroupsResponse200DataItem
    from ..models.get_api_groups_response_200_pagination import GetApiGroupsResponse200Pagination


T = TypeVar("T", bound="GetApiGroupsResponse200")


@_attrs_define
class GetApiGroupsResponse200:
    """
    Attributes:
        data (list[GetApiGroupsResponse200DataItem]):
        pagination (GetApiGroupsResponse200Pagination):
    """

    data: list[GetApiGroupsResponse200DataItem]
    pagination: GetApiGroupsResponse200Pagination

    def to_dict(self) -> dict[str, Any]:
        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        pagination = self.pagination.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
                "pagination": pagination,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_groups_response_200_data_item import GetApiGroupsResponse200DataItem
        from ..models.get_api_groups_response_200_pagination import GetApiGroupsResponse200Pagination

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = GetApiGroupsResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        pagination = GetApiGroupsResponse200Pagination.from_dict(d.pop("pagination"))

        get_api_groups_response_200 = cls(
            data=data,
            pagination=pagination,
        )

        return get_api_groups_response_200
