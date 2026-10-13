from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="IngestTurnResultBodyToolCallsItem")


@_attrs_define
class IngestTurnResultBodyToolCallsItem:
    """
    Attributes:
        id (str):
        name (str):
        input_ (Any | Unset):
        output (str | Unset):
        is_error (bool | Unset):
        result (Any | Unset):
    """

    id: str
    name: str
    input_: Any | Unset = UNSET
    output: str | Unset = UNSET
    is_error: bool | Unset = UNSET
    result: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        input_ = self.input_

        output = self.output

        is_error = self.is_error

        result = self.result

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
            }
        )
        if input_ is not UNSET:
            field_dict["input"] = input_
        if output is not UNSET:
            field_dict["output"] = output
        if is_error is not UNSET:
            field_dict["isError"] = is_error
        if result is not UNSET:
            field_dict["result"] = result

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        input_ = d.pop("input", UNSET)

        output = d.pop("output", UNSET)

        is_error = d.pop("isError", UNSET)

        result = d.pop("result", UNSET)

        ingest_turn_result_body_tool_calls_item = cls(
            id=id,
            name=name,
            input_=input_,
            output=output,
            is_error=is_error,
            result=result,
        )

        ingest_turn_result_body_tool_calls_item.additional_properties = d
        return ingest_turn_result_body_tool_calls_item

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
