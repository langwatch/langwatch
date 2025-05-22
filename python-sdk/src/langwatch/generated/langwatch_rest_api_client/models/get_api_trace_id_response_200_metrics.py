from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200Metrics")


@_attrs_define
class GetApiTraceIdResponse200Metrics:
    """
    Attributes:
        first_token_ms (Union[Unset, int]):  Example: 1449.
        total_time_ms (Union[Unset, int]):  Example: 1543.
        prompt_tokens (Union[Unset, int]):  Example: 20.
        completion_tokens (Union[Unset, int]):  Example: 7.
        tokens_estimated (Union[Unset, bool]):  Example: True.
    """

    first_token_ms: Union[Unset, int] = UNSET
    total_time_ms: Union[Unset, int] = UNSET
    prompt_tokens: Union[Unset, int] = UNSET
    completion_tokens: Union[Unset, int] = UNSET
    tokens_estimated: Union[Unset, bool] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        first_token_ms = self.first_token_ms

        total_time_ms = self.total_time_ms

        prompt_tokens = self.prompt_tokens

        completion_tokens = self.completion_tokens

        tokens_estimated = self.tokens_estimated

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if first_token_ms is not UNSET:
            field_dict["first_token_ms"] = first_token_ms
        if total_time_ms is not UNSET:
            field_dict["total_time_ms"] = total_time_ms
        if prompt_tokens is not UNSET:
            field_dict["prompt_tokens"] = prompt_tokens
        if completion_tokens is not UNSET:
            field_dict["completion_tokens"] = completion_tokens
        if tokens_estimated is not UNSET:
            field_dict["tokens_estimated"] = tokens_estimated

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        first_token_ms = d.pop("first_token_ms", UNSET)

        total_time_ms = d.pop("total_time_ms", UNSET)

        prompt_tokens = d.pop("prompt_tokens", UNSET)

        completion_tokens = d.pop("completion_tokens", UNSET)

        tokens_estimated = d.pop("tokens_estimated", UNSET)

        get_api_trace_id_response_200_metrics = cls(
            first_token_ms=first_token_ms,
            total_time_ms=total_time_ms,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            tokens_estimated=tokens_estimated,
        )

        get_api_trace_id_response_200_metrics.additional_properties = d
        return get_api_trace_id_response_200_metrics

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
