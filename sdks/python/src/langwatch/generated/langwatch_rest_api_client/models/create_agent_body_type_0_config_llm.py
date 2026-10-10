from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_0_config_llm_litellm_params import CreateAgentBodyType0ConfigLlmLitellmParams


T = TypeVar("T", bound="CreateAgentBodyType0ConfigLlm")


@_attrs_define
class CreateAgentBodyType0ConfigLlm:
    """
    Attributes:
        model (str):
        temperature (float | Unset):
        max_tokens (float | Unset):
        top_p (float | Unset):
        frequency_penalty (float | Unset):
        presence_penalty (float | Unset):
        seed (float | Unset):
        top_k (float | Unset):
        min_p (float | Unset):
        repetition_penalty (float | Unset):
        reasoning (str | Unset):
        reasoning_effort (str | Unset):
        thinking_level (str | Unset):
        effort (str | Unset):
        verbosity (str | Unset):
        litellm_params (CreateAgentBodyType0ConfigLlmLitellmParams | Unset):
    """

    model: str
    temperature: float | Unset = UNSET
    max_tokens: float | Unset = UNSET
    top_p: float | Unset = UNSET
    frequency_penalty: float | Unset = UNSET
    presence_penalty: float | Unset = UNSET
    seed: float | Unset = UNSET
    top_k: float | Unset = UNSET
    min_p: float | Unset = UNSET
    repetition_penalty: float | Unset = UNSET
    reasoning: str | Unset = UNSET
    reasoning_effort: str | Unset = UNSET
    thinking_level: str | Unset = UNSET
    effort: str | Unset = UNSET
    verbosity: str | Unset = UNSET
    litellm_params: CreateAgentBodyType0ConfigLlmLitellmParams | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        model = self.model

        temperature = self.temperature

        max_tokens = self.max_tokens

        top_p = self.top_p

        frequency_penalty = self.frequency_penalty

        presence_penalty = self.presence_penalty

        seed = self.seed

        top_k = self.top_k

        min_p = self.min_p

        repetition_penalty = self.repetition_penalty

        reasoning = self.reasoning

        reasoning_effort = self.reasoning_effort

        thinking_level = self.thinking_level

        effort = self.effort

        verbosity = self.verbosity

        litellm_params: dict[str, Any] | Unset = UNSET
        if not isinstance(self.litellm_params, Unset):
            litellm_params = self.litellm_params.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "model": model,
            }
        )
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if max_tokens is not UNSET:
            field_dict["max_tokens"] = max_tokens
        if top_p is not UNSET:
            field_dict["top_p"] = top_p
        if frequency_penalty is not UNSET:
            field_dict["frequency_penalty"] = frequency_penalty
        if presence_penalty is not UNSET:
            field_dict["presence_penalty"] = presence_penalty
        if seed is not UNSET:
            field_dict["seed"] = seed
        if top_k is not UNSET:
            field_dict["top_k"] = top_k
        if min_p is not UNSET:
            field_dict["min_p"] = min_p
        if repetition_penalty is not UNSET:
            field_dict["repetition_penalty"] = repetition_penalty
        if reasoning is not UNSET:
            field_dict["reasoning"] = reasoning
        if reasoning_effort is not UNSET:
            field_dict["reasoning_effort"] = reasoning_effort
        if thinking_level is not UNSET:
            field_dict["thinkingLevel"] = thinking_level
        if effort is not UNSET:
            field_dict["effort"] = effort
        if verbosity is not UNSET:
            field_dict["verbosity"] = verbosity
        if litellm_params is not UNSET:
            field_dict["litellm_params"] = litellm_params

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_0_config_llm_litellm_params import (
            CreateAgentBodyType0ConfigLlmLitellmParams,
        )

        d = dict(src_dict)
        model = d.pop("model")

        temperature = d.pop("temperature", UNSET)

        max_tokens = d.pop("max_tokens", UNSET)

        top_p = d.pop("top_p", UNSET)

        frequency_penalty = d.pop("frequency_penalty", UNSET)

        presence_penalty = d.pop("presence_penalty", UNSET)

        seed = d.pop("seed", UNSET)

        top_k = d.pop("top_k", UNSET)

        min_p = d.pop("min_p", UNSET)

        repetition_penalty = d.pop("repetition_penalty", UNSET)

        reasoning = d.pop("reasoning", UNSET)

        reasoning_effort = d.pop("reasoning_effort", UNSET)

        thinking_level = d.pop("thinkingLevel", UNSET)

        effort = d.pop("effort", UNSET)

        verbosity = d.pop("verbosity", UNSET)

        _litellm_params = d.pop("litellm_params", UNSET)
        litellm_params: CreateAgentBodyType0ConfigLlmLitellmParams | Unset
        if isinstance(_litellm_params, Unset):
            litellm_params = UNSET
        else:
            litellm_params = CreateAgentBodyType0ConfigLlmLitellmParams.from_dict(_litellm_params)

        create_agent_body_type_0_config_llm = cls(
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
            seed=seed,
            top_k=top_k,
            min_p=min_p,
            repetition_penalty=repetition_penalty,
            reasoning=reasoning,
            reasoning_effort=reasoning_effort,
            thinking_level=thinking_level,
            effort=effort,
            verbosity=verbosity,
            litellm_params=litellm_params,
        )

        create_agent_body_type_0_config_llm.additional_properties = d
        return create_agent_body_type_0_config_llm

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
