from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiTriggersBodyType2ReportSourceType1")


@_attrs_define
class PostApiTriggersBodyType2ReportSourceType1:
    """
    Attributes:
        kind (Literal['customGraph']):
        custom_graph_id (str):
    """

    kind: Literal["customGraph"]
    custom_graph_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        custom_graph_id = self.custom_graph_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_triggers_body_type_2_report_source_type_1 = cls(
            kind=kind,
            custom_graph_id=custom_graph_id,
        )

        post_api_triggers_body_type_2_report_source_type_1.additional_properties = d
        return post_api_triggers_body_type_2_report_source_type_1

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
