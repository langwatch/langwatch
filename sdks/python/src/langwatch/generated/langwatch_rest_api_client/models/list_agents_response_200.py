from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.list_agents_response_200_data_item import ListAgentsResponse200DataItem
    from ..models.list_agents_response_200_pagination import ListAgentsResponse200Pagination


T = TypeVar("T", bound="ListAgentsResponse200")


@_attrs_define
class ListAgentsResponse200:
    """
    Attributes:
        data (list[ListAgentsResponse200DataItem]):
        pagination (ListAgentsResponse200Pagination):
    """

    data: list[ListAgentsResponse200DataItem]
    pagination: ListAgentsResponse200Pagination

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
        from ..models.list_agents_response_200_data_item import ListAgentsResponse200DataItem
        from ..models.list_agents_response_200_pagination import ListAgentsResponse200Pagination

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = ListAgentsResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        pagination = ListAgentsResponse200Pagination.from_dict(d.pop("pagination"))

        list_agents_response_200 = cls(
            data=data,
            pagination=pagination,
        )

        return list_agents_response_200
