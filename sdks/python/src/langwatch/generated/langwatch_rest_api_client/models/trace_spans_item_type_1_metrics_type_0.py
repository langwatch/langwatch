from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="TraceSpansItemType1MetricsType0")


@_attrs_define
class TraceSpansItemType1MetricsType0:
    """
    Attributes:
        prompt_tokens (float | None | Unset):
        completion_tokens (float | None | Unset):
        reasoning_tokens (float | None | Unset):
        cache_read_input_tokens (float | None | Unset):
        cache_creation_input_tokens (float | None | Unset):
        tokens_estimated (bool | None | Unset):
        cost (float | None | Unset):
    """

    prompt_tokens: float | None | Unset = UNSET
    completion_tokens: float | None | Unset = UNSET
    reasoning_tokens: float | None | Unset = UNSET
    cache_read_input_tokens: float | None | Unset = UNSET
    cache_creation_input_tokens: float | None | Unset = UNSET
    tokens_estimated: bool | None | Unset = UNSET
    cost: float | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        prompt_tokens: float | None | Unset
        if isinstance(self.prompt_tokens, Unset):
            prompt_tokens = UNSET
        else:
            prompt_tokens = self.prompt_tokens

        completion_tokens: float | None | Unset
        if isinstance(self.completion_tokens, Unset):
            completion_tokens = UNSET
        else:
            completion_tokens = self.completion_tokens

        reasoning_tokens: float | None | Unset
        if isinstance(self.reasoning_tokens, Unset):
            reasoning_tokens = UNSET
        else:
            reasoning_tokens = self.reasoning_tokens

        cache_read_input_tokens: float | None | Unset
        if isinstance(self.cache_read_input_tokens, Unset):
            cache_read_input_tokens = UNSET
        else:
            cache_read_input_tokens = self.cache_read_input_tokens

        cache_creation_input_tokens: float | None | Unset
        if isinstance(self.cache_creation_input_tokens, Unset):
            cache_creation_input_tokens = UNSET
        else:
            cache_creation_input_tokens = self.cache_creation_input_tokens

        tokens_estimated: bool | None | Unset
        if isinstance(self.tokens_estimated, Unset):
            tokens_estimated = UNSET
        else:
            tokens_estimated = self.tokens_estimated

        cost: float | None | Unset
        if isinstance(self.cost, Unset):
            cost = UNSET
        else:
            cost = self.cost

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if prompt_tokens is not UNSET:
            field_dict["prompt_tokens"] = prompt_tokens
        if completion_tokens is not UNSET:
            field_dict["completion_tokens"] = completion_tokens
        if reasoning_tokens is not UNSET:
            field_dict["reasoning_tokens"] = reasoning_tokens
        if cache_read_input_tokens is not UNSET:
            field_dict["cache_read_input_tokens"] = cache_read_input_tokens
        if cache_creation_input_tokens is not UNSET:
            field_dict["cache_creation_input_tokens"] = cache_creation_input_tokens
        if tokens_estimated is not UNSET:
            field_dict["tokens_estimated"] = tokens_estimated
        if cost is not UNSET:
            field_dict["cost"] = cost

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_prompt_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        prompt_tokens = _parse_prompt_tokens(d.pop("prompt_tokens", UNSET))

        def _parse_completion_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        completion_tokens = _parse_completion_tokens(d.pop("completion_tokens", UNSET))

        def _parse_reasoning_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        reasoning_tokens = _parse_reasoning_tokens(d.pop("reasoning_tokens", UNSET))

        def _parse_cache_read_input_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cache_read_input_tokens = _parse_cache_read_input_tokens(d.pop("cache_read_input_tokens", UNSET))

        def _parse_cache_creation_input_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cache_creation_input_tokens = _parse_cache_creation_input_tokens(d.pop("cache_creation_input_tokens", UNSET))

        def _parse_tokens_estimated(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        tokens_estimated = _parse_tokens_estimated(d.pop("tokens_estimated", UNSET))

        def _parse_cost(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cost = _parse_cost(d.pop("cost", UNSET))

        trace_spans_item_type_1_metrics_type_0 = cls(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reasoning_tokens=reasoning_tokens,
            cache_read_input_tokens=cache_read_input_tokens,
            cache_creation_input_tokens=cache_creation_input_tokens,
            tokens_estimated=tokens_estimated,
            cost=cost,
        )

        trace_spans_item_type_1_metrics_type_0.additional_properties = d
        return trace_spans_item_type_1_metrics_type_0

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
