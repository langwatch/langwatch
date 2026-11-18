from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SpanInputOutputType1ValueItemContentType0Type1ItemType6")


@_attrs_define
class SpanInputOutputType1ValueItemContentType0Type1ItemType6:
    """
    Attributes:
        type_ (Literal['tool-result']):
        tool_name (str | Unset):
        tool_call_id (str | Unset):
        output (Any | Unset):
    """

    type_: Literal["tool-result"]
    tool_name: str | Unset = UNSET
    tool_call_id: str | Unset = UNSET
    output: Any | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        tool_name = self.tool_name

        tool_call_id = self.tool_call_id

        output = self.output

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
            }
        )
        if tool_name is not UNSET:
            field_dict["toolName"] = tool_name
        if tool_call_id is not UNSET:
            field_dict["toolCallId"] = tool_call_id
        if output is not UNSET:
            field_dict["output"] = output

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["tool-result"], d.pop("type"))
        if type_ != "tool-result":
            raise ValueError(f"type must match const 'tool-result', got '{type_}'")

        tool_name = d.pop("toolName", UNSET)

        tool_call_id = d.pop("toolCallId", UNSET)

        output = d.pop("output", UNSET)

        span_input_output_type_1_value_item_content_type_0_type_1_item_type_6 = cls(
            type_=type_,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            output=output,
        )

        return span_input_output_type_1_value_item_content_type_0_type_1_item_type_6
