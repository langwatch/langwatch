from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200SpansItemParams")


@_attrs_define
class GetApiTraceIdResponse200SpansItemParams:
    """
    Attributes:
        stream (Union[Unset, bool]):  Example: True.
        temperature (Union[Unset, float]):  Example: 1.
    """

    stream: Union[Unset, bool] = UNSET
    temperature: Union[Unset, float] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        stream = self.stream

        temperature = self.temperature

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if stream is not UNSET:
            field_dict["stream"] = stream
        if temperature is not UNSET:
            field_dict["temperature"] = temperature

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        stream = d.pop("stream", UNSET)

        temperature = d.pop("temperature", UNSET)

        get_api_trace_id_response_200_spans_item_params = cls(
            stream=stream,
            temperature=temperature,
        )

        get_api_trace_id_response_200_spans_item_params.additional_properties = d
        return get_api_trace_id_response_200_spans_item_params

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
