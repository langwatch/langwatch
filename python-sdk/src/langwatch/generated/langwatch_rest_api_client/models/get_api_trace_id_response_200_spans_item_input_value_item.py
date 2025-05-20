from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200SpansItemInputValueItem")


@_attrs_define
class GetApiTraceIdResponse200SpansItemInputValueItem:
    """
    Attributes:
        role (Union[Unset, str]):  Example: system.
        content (Union[Unset, str]):  Example: You are a helpful assistant that only reply in short tweet-like
            responses, using lots of emojis..
    """

    role: Union[Unset, str] = UNSET
    content: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role = self.role

        content = self.content

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if role is not UNSET:
            field_dict["role"] = role
        if content is not UNSET:
            field_dict["content"] = content

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = d.pop("role", UNSET)

        content = d.pop("content", UNSET)

        get_api_trace_id_response_200_spans_item_input_value_item = cls(
            role=role,
            content=content,
        )

        get_api_trace_id_response_200_spans_item_input_value_item.additional_properties = d
        return get_api_trace_id_response_200_spans_item_input_value_item

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
