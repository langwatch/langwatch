from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_boards_by_board_id_widgets_response_200_data_item import (
        GetApiBoardsByBoardIdWidgetsResponse200DataItem,
    )


T = TypeVar("T", bound="GetApiBoardsByBoardIdWidgetsResponse200")


@_attrs_define
class GetApiBoardsByBoardIdWidgetsResponse200:
    """
    Attributes:
        data (list[GetApiBoardsByBoardIdWidgetsResponse200DataItem]):
    """

    data: list[GetApiBoardsByBoardIdWidgetsResponse200DataItem]

    def to_dict(self) -> dict[str, Any]:
        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_boards_by_board_id_widgets_response_200_data_item import (
            GetApiBoardsByBoardIdWidgetsResponse200DataItem,
        )

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = GetApiBoardsByBoardIdWidgetsResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        get_api_boards_by_board_id_widgets_response_200 = cls(
            data=data,
        )

        return get_api_boards_by_board_id_widgets_response_200
