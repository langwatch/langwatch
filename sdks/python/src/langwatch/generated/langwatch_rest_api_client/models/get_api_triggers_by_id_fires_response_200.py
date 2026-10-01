from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_triggers_by_id_fires_response_200_fires_item import (
        GetApiTriggersByIdFiresResponse200FiresItem,
    )


T = TypeVar("T", bound="GetApiTriggersByIdFiresResponse200")


@_attrs_define
class GetApiTriggersByIdFiresResponse200:
    """
    Attributes:
        fires (list[GetApiTriggersByIdFiresResponse200FiresItem]): One page of fires, newest first.
        next_cursor (None | str): Pass as `cursor` to read the page after this one. Null on the last page.
    """

    fires: list[GetApiTriggersByIdFiresResponse200FiresItem]
    next_cursor: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        fires = []
        for fires_item_data in self.fires:
            fires_item = fires_item_data.to_dict()
            fires.append(fires_item)

        next_cursor: None | str
        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "fires": fires,
                "nextCursor": next_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_triggers_by_id_fires_response_200_fires_item import (
            GetApiTriggersByIdFiresResponse200FiresItem,
        )

        d = dict(src_dict)
        fires = []
        _fires = d.pop("fires")
        for fires_item_data in _fires:
            fires_item = GetApiTriggersByIdFiresResponse200FiresItem.from_dict(fires_item_data)

            fires.append(fires_item)

        def _parse_next_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))

        get_api_triggers_by_id_fires_response_200 = cls(
            fires=fires,
            next_cursor=next_cursor,
        )

        get_api_triggers_by_id_fires_response_200.additional_properties = d
        return get_api_triggers_by_id_fires_response_200

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
