from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiTraceIdResponse200SpansItemMetrics")


@_attrs_define
class GetApiTraceIdResponse200SpansItemMetrics:
    """
    Attributes:
        tokens_estimated (bool | Unset):  Example: True.
        completion_tokens (int | Unset):  Example: 7.
        prompt_tokens (int | Unset):  Example: 20.
    """

    tokens_estimated: bool | Unset = UNSET
    completion_tokens: int | Unset = UNSET
    prompt_tokens: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        tokens_estimated = self.tokens_estimated

        completion_tokens = self.completion_tokens

        prompt_tokens = self.prompt_tokens

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if tokens_estimated is not UNSET:
            field_dict["tokens_estimated"] = tokens_estimated
        if completion_tokens is not UNSET:
            field_dict["completion_tokens"] = completion_tokens
        if prompt_tokens is not UNSET:
            field_dict["prompt_tokens"] = prompt_tokens

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        tokens_estimated = d.pop("tokens_estimated", UNSET)

        completion_tokens = d.pop("completion_tokens", UNSET)

        prompt_tokens = d.pop("prompt_tokens", UNSET)

        get_api_trace_id_response_200_spans_item_metrics = cls(
            tokens_estimated=tokens_estimated,
            completion_tokens=completion_tokens,
            prompt_tokens=prompt_tokens,
        )

        get_api_trace_id_response_200_spans_item_metrics.additional_properties = d
        return get_api_trace_id_response_200_spans_item_metrics

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
