from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTriggersByIdFiresResponse200FiresItem")


@_attrs_define
class GetApiTriggersByIdFiresResponse200FiresItem:
    """
    Attributes:
        id (str):
        trigger_id (str):
        custom_graph_id (None | str):
        fired_at (str):
        resolved_at (None | str):
    """

    id: str
    trigger_id: str
    custom_graph_id: None | str
    fired_at: str
    resolved_at: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        trigger_id = self.trigger_id

        custom_graph_id: None | str
        custom_graph_id = self.custom_graph_id

        fired_at = self.fired_at

        resolved_at: None | str
        resolved_at = self.resolved_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "triggerId": trigger_id,
                "customGraphId": custom_graph_id,
                "firedAt": fired_at,
                "resolvedAt": resolved_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        trigger_id = d.pop("triggerId")

        def _parse_custom_graph_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        custom_graph_id = _parse_custom_graph_id(d.pop("customGraphId"))

        fired_at = d.pop("firedAt")

        def _parse_resolved_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        resolved_at = _parse_resolved_at(d.pop("resolvedAt"))

        get_api_triggers_by_id_fires_response_200_fires_item = cls(
            id=id,
            trigger_id=trigger_id,
            custom_graph_id=custom_graph_id,
            fired_at=fired_at,
            resolved_at=resolved_at,
        )

        return get_api_triggers_by_id_fires_response_200_fires_item
