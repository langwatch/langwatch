from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_trace_id_response_200_spans_item_input_value_item import (
        GetApiTraceIdResponse200SpansItemInputValueItem,
    )


T = TypeVar("T", bound="GetApiTraceIdResponse200SpansItemInput")


@_attrs_define
class GetApiTraceIdResponse200SpansItemInput:
    """
    Attributes:
        type_ (Union[Unset, str]):  Example: chat_messages.
        value (Union[Unset, list['GetApiTraceIdResponse200SpansItemInputValueItem']]):  Example: [{'role': 'system',
            'content': 'You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.'},
            {'role': 'user', 'content': 'hi'}].
    """

    type_: Union[Unset, str] = UNSET
    value: Union[Unset, list["GetApiTraceIdResponse200SpansItemInputValueItem"]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        value: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.value, Unset):
            value = []
            for value_item_data in self.value:
                value_item = value_item_data.to_dict()
                value.append(value_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if type_ is not UNSET:
            field_dict["type"] = type_
        if value is not UNSET:
            field_dict["value"] = value

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_trace_id_response_200_spans_item_input_value_item import (
            GetApiTraceIdResponse200SpansItemInputValueItem,
        )

        d = dict(src_dict)
        type_ = d.pop("type", UNSET)

        value = []
        _value = d.pop("value", UNSET)
        for value_item_data in _value or []:
            value_item = GetApiTraceIdResponse200SpansItemInputValueItem.from_dict(value_item_data)

            value.append(value_item)

        get_api_trace_id_response_200_spans_item_input = cls(
            type_=type_,
            value=value,
        )

        get_api_trace_id_response_200_spans_item_input.additional_properties = d
        return get_api_trace_id_response_200_spans_item_input

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
