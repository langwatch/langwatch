from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemPartsItemType3")


@_attrs_define
class SpanInputOutputType1ValueItemPartsItemType3:
    """
    Attributes:
        type_ (Literal['tool_call']):
        tool_name (str | Unset):
        tool_call_id (str | Unset):
        args (str | Unset):
    """

    type_: Literal["tool_call"]
    tool_name: str | Unset = UNSET
    tool_call_id: str | Unset = UNSET
    args: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        tool_name = self.tool_name

        tool_call_id = self.tool_call_id

        args = self.args

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
            }
        )
        if tool_name is not UNSET:
            field_dict["toolName"] = tool_name
        if tool_call_id is not UNSET:
            field_dict["toolCallId"] = tool_call_id
        if args is not UNSET:
            field_dict["args"] = args

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["tool_call"], d.pop("type"))
        if type_ != "tool_call":
            raise ValueError(f"type must match const 'tool_call', got '{type_}'")

        tool_name = d.pop("toolName", UNSET)

        tool_call_id = d.pop("toolCallId", UNSET)

        args = d.pop("args", UNSET)

        span_input_output_type_1_value_item_parts_item_type_3 = cls(
            type_=type_,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            args=args,
        )

        span_input_output_type_1_value_item_parts_item_type_3.additional_properties = d
        return span_input_output_type_1_value_item_parts_item_type_3

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
