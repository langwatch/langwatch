from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiTriggersResponse200ItemReportType0SourceType1")


@_attrs_define
class GetApiTriggersResponse200ItemReportType0SourceType1:
    """
    Attributes:
        kind (Literal['customGraph']):
        custom_graph_id (str):
    """

    kind: Literal["customGraph"]
    custom_graph_id: str

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        custom_graph_id = self.custom_graph_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "customGraphId": custom_graph_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["customGraph"], d.pop("kind"))
        if kind != "customGraph":
            raise ValueError(f"kind must match const 'customGraph', got '{kind}'")

        custom_graph_id = d.pop("customGraphId")

        get_api_triggers_response_200_item_report_type_0_source_type_1 = cls(
            kind=kind,
            custom_graph_id=custom_graph_id,
        )

        return get_api_triggers_response_200_item_report_type_0_source_type_1
