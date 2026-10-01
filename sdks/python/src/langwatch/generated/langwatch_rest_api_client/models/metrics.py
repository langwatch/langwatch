from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="Metrics")


@_attrs_define
class Metrics:
    """
    Attributes:
        first_token_ms (int | None | Unset):
        total_time_ms (int | None | Unset):
        prompt_tokens (int | None | Unset):
        completion_tokens (int | None | Unset):
        reasoning_tokens (float | None | Unset):
        cache_read_input_tokens (float | None | Unset):
        cache_creation_input_tokens (float | None | Unset):
        cache_creation_5m_input_tokens (float | None | Unset):
        cache_creation_1h_input_tokens (float | None | Unset):
        context_size_tokens (float | None | Unset):
        total_cost (float | None | Unset):
        tokens_estimated (bool | None | Unset):
    """

    first_token_ms: int | None | Unset = UNSET
    total_time_ms: int | None | Unset = UNSET
    prompt_tokens: int | None | Unset = UNSET
    completion_tokens: int | None | Unset = UNSET
    reasoning_tokens: float | None | Unset = UNSET
    cache_read_input_tokens: float | None | Unset = UNSET
    cache_creation_input_tokens: float | None | Unset = UNSET
    cache_creation_5m_input_tokens: float | None | Unset = UNSET
    cache_creation_1h_input_tokens: float | None | Unset = UNSET
    context_size_tokens: float | None | Unset = UNSET
    total_cost: float | None | Unset = UNSET
    tokens_estimated: bool | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        first_token_ms: int | None | Unset
        if isinstance(self.first_token_ms, Unset):
            first_token_ms = UNSET
        else:
            first_token_ms = self.first_token_ms

        total_time_ms: int | None | Unset
        if isinstance(self.total_time_ms, Unset):
            total_time_ms = UNSET
        else:
            total_time_ms = self.total_time_ms

        prompt_tokens: int | None | Unset
        if isinstance(self.prompt_tokens, Unset):
            prompt_tokens = UNSET
        else:
            prompt_tokens = self.prompt_tokens

        completion_tokens: int | None | Unset
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

        cache_creation_5m_input_tokens: float | None | Unset
        if isinstance(self.cache_creation_5m_input_tokens, Unset):
            cache_creation_5m_input_tokens = UNSET
        else:
            cache_creation_5m_input_tokens = self.cache_creation_5m_input_tokens

        cache_creation_1h_input_tokens: float | None | Unset
        if isinstance(self.cache_creation_1h_input_tokens, Unset):
            cache_creation_1h_input_tokens = UNSET
        else:
            cache_creation_1h_input_tokens = self.cache_creation_1h_input_tokens

        context_size_tokens: float | None | Unset
        if isinstance(self.context_size_tokens, Unset):
            context_size_tokens = UNSET
        else:
            context_size_tokens = self.context_size_tokens

        total_cost: float | None | Unset
        if isinstance(self.total_cost, Unset):
            total_cost = UNSET
        else:
            total_cost = self.total_cost

        tokens_estimated: bool | None | Unset
        if isinstance(self.tokens_estimated, Unset):
            tokens_estimated = UNSET
        else:
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
        if reasoning_tokens is not UNSET:
            field_dict["reasoning_tokens"] = reasoning_tokens
        if cache_read_input_tokens is not UNSET:
            field_dict["cache_read_input_tokens"] = cache_read_input_tokens
        if cache_creation_input_tokens is not UNSET:
            field_dict["cache_creation_input_tokens"] = cache_creation_input_tokens
        if cache_creation_5m_input_tokens is not UNSET:
            field_dict["cache_creation_5m_input_tokens"] = cache_creation_5m_input_tokens
        if cache_creation_1h_input_tokens is not UNSET:
            field_dict["cache_creation_1h_input_tokens"] = cache_creation_1h_input_tokens
        if context_size_tokens is not UNSET:
            field_dict["context_size_tokens"] = context_size_tokens
        if total_cost is not UNSET:
            field_dict["total_cost"] = total_cost
        if tokens_estimated is not UNSET:
            field_dict["tokens_estimated"] = tokens_estimated

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_first_token_ms(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        first_token_ms = _parse_first_token_ms(d.pop("first_token_ms", UNSET))

        def _parse_total_time_ms(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        total_time_ms = _parse_total_time_ms(d.pop("total_time_ms", UNSET))

        def _parse_prompt_tokens(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        prompt_tokens = _parse_prompt_tokens(d.pop("prompt_tokens", UNSET))

        def _parse_completion_tokens(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

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

        def _parse_cache_creation_5m_input_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cache_creation_5m_input_tokens = _parse_cache_creation_5m_input_tokens(
            d.pop("cache_creation_5m_input_tokens", UNSET)
        )

        def _parse_cache_creation_1h_input_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cache_creation_1h_input_tokens = _parse_cache_creation_1h_input_tokens(
            d.pop("cache_creation_1h_input_tokens", UNSET)
        )

        def _parse_context_size_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        context_size_tokens = _parse_context_size_tokens(d.pop("context_size_tokens", UNSET))

        def _parse_total_cost(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        total_cost = _parse_total_cost(d.pop("total_cost", UNSET))

        def _parse_tokens_estimated(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        tokens_estimated = _parse_tokens_estimated(d.pop("tokens_estimated", UNSET))

        metrics = cls(
            first_token_ms=first_token_ms,
            total_time_ms=total_time_ms,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reasoning_tokens=reasoning_tokens,
            cache_read_input_tokens=cache_read_input_tokens,
            cache_creation_input_tokens=cache_creation_input_tokens,
            cache_creation_5m_input_tokens=cache_creation_5m_input_tokens,
            cache_creation_1h_input_tokens=cache_creation_1h_input_tokens,
            context_size_tokens=context_size_tokens,
            total_cost=total_cost,
            tokens_estimated=tokens_estimated,
        )

        metrics.additional_properties = d
        return metrics

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
