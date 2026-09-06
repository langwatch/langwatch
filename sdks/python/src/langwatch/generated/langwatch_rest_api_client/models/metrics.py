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
        tokens_estimated (bool | Unset):
        completion_tokens (int | Unset):
        prompt_tokens (int | Unset):
        total_cost (float | Unset):
        total_time_ms (int | Unset):
        first_token_ms (int | None | Unset):
    """

    tokens_estimated: bool | Unset = UNSET
    completion_tokens: int | Unset = UNSET
    prompt_tokens: int | Unset = UNSET
    total_cost: float | Unset = UNSET
    total_time_ms: int | Unset = UNSET
    first_token_ms: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        tokens_estimated = self.tokens_estimated

        completion_tokens = self.completion_tokens

        prompt_tokens = self.prompt_tokens

        total_cost = self.total_cost

        total_time_ms = self.total_time_ms

        first_token_ms: int | None | Unset
        if isinstance(self.first_token_ms, Unset):
            first_token_ms = UNSET
        else:
            first_token_ms = self.first_token_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if tokens_estimated is not UNSET:
            field_dict["tokens_estimated"] = tokens_estimated
        if completion_tokens is not UNSET:
            field_dict["completion_tokens"] = completion_tokens
        if prompt_tokens is not UNSET:
            field_dict["prompt_tokens"] = prompt_tokens
        if total_cost is not UNSET:
            field_dict["total_cost"] = total_cost
        if total_time_ms is not UNSET:
            field_dict["total_time_ms"] = total_time_ms
        if first_token_ms is not UNSET:
            field_dict["first_token_ms"] = first_token_ms

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        tokens_estimated = d.pop("tokens_estimated", UNSET)

        completion_tokens = d.pop("completion_tokens", UNSET)

        prompt_tokens = d.pop("prompt_tokens", UNSET)

        total_cost = d.pop("total_cost", UNSET)

        total_time_ms = d.pop("total_time_ms", UNSET)

        def _parse_first_token_ms(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        first_token_ms = _parse_first_token_ms(d.pop("first_token_ms", UNSET))

        metrics = cls(
            tokens_estimated=tokens_estimated,
            completion_tokens=completion_tokens,
            prompt_tokens=prompt_tokens,
            total_cost=total_cost,
            total_time_ms=total_time_ms,
            first_token_ms=first_token_ms,
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
