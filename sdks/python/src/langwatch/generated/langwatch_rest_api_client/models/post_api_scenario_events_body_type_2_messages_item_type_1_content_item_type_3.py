from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3")


@_attrs_define
class PostApiScenarioEventsBodyType2MessagesItemType1ContentItemType3:
    """
    Attributes:
        type_ (Literal['thinking']):
        thinking (str):
        signature (str | Unset):
    """

    type_: Literal["thinking"]
    thinking: str
    signature: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        thinking = self.thinking

        signature = self.signature

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "thinking": thinking,
            }
        )
        if signature is not UNSET:
            field_dict["signature"] = signature

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["thinking"], d.pop("type"))
        if type_ != "thinking":
            raise ValueError(f"type must match const 'thinking', got '{type_}'")

        thinking = d.pop("thinking")

        signature = d.pop("signature", UNSET)

        post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_3 = cls(
            type_=type_,
            thinking=thinking,
            signature=signature,
        )

        post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_3.additional_properties = d
        return post_api_scenario_events_body_type_2_messages_item_type_1_content_item_type_3

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
