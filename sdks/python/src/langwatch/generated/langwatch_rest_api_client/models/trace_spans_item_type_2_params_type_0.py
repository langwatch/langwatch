from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.trace_spans_item_type_2_params_type_0_functions_type_0_item import (
        TraceSpansItemType2ParamsType0FunctionsType0Item,
    )
    from ..models.trace_spans_item_type_2_params_type_0_logit_bias_type_0 import (
        TraceSpansItemType2ParamsType0LogitBiasType0,
    )
    from ..models.trace_spans_item_type_2_params_type_0_tool_choice_type_0_type_0 import (
        TraceSpansItemType2ParamsType0ToolChoiceType0Type0,
    )
    from ..models.trace_spans_item_type_2_params_type_0_tools_type_0_item import (
        TraceSpansItemType2ParamsType0ToolsType0Item,
    )


T = TypeVar("T", bound="TraceSpansItemType2ParamsType0")


@_attrs_define
class TraceSpansItemType2ParamsType0:
    """
    Attributes:
        frequency_penalty (float | None | Unset):
        logit_bias (None | TraceSpansItemType2ParamsType0LogitBiasType0 | Unset):
        logprobs (bool | None | Unset):
        top_logprobs (float | None | Unset):
        max_tokens (float | None | Unset):
        n (float | None | Unset):
        presence_penalty (float | None | Unset):
        seed (float | None | Unset):
        stop (list[str] | None | str | Unset):
        stream (bool | None | Unset):
        temperature (float | None | Unset):
        top_p (float | None | Unset):
        tools (list[TraceSpansItemType2ParamsType0ToolsType0Item] | None | Unset):
        tool_choice (None | str | TraceSpansItemType2ParamsType0ToolChoiceType0Type0 | Unset):
        parallel_tool_calls (bool | None | Unset):
        functions (list[TraceSpansItemType2ParamsType0FunctionsType0Item] | None | Unset):
        user (None | str | Unset):
        reasoning_effort (None | str | Unset):
    """

    frequency_penalty: float | None | Unset = UNSET
    logit_bias: None | TraceSpansItemType2ParamsType0LogitBiasType0 | Unset = UNSET
    logprobs: bool | None | Unset = UNSET
    top_logprobs: float | None | Unset = UNSET
    max_tokens: float | None | Unset = UNSET
    n: float | None | Unset = UNSET
    presence_penalty: float | None | Unset = UNSET
    seed: float | None | Unset = UNSET
    stop: list[str] | None | str | Unset = UNSET
    stream: bool | None | Unset = UNSET
    temperature: float | None | Unset = UNSET
    top_p: float | None | Unset = UNSET
    tools: list[TraceSpansItemType2ParamsType0ToolsType0Item] | None | Unset = UNSET
    tool_choice: None | str | TraceSpansItemType2ParamsType0ToolChoiceType0Type0 | Unset = UNSET
    parallel_tool_calls: bool | None | Unset = UNSET
    functions: list[TraceSpansItemType2ParamsType0FunctionsType0Item] | None | Unset = UNSET
    user: None | str | Unset = UNSET
    reasoning_effort: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.trace_spans_item_type_2_params_type_0_logit_bias_type_0 import (
            TraceSpansItemType2ParamsType0LogitBiasType0,
        )
        from ..models.trace_spans_item_type_2_params_type_0_tool_choice_type_0_type_0 import (
            TraceSpansItemType2ParamsType0ToolChoiceType0Type0,
        )

        frequency_penalty: float | None | Unset
        if isinstance(self.frequency_penalty, Unset):
            frequency_penalty = UNSET
        else:
            frequency_penalty = self.frequency_penalty

        logit_bias: dict[str, Any] | None | Unset
        if isinstance(self.logit_bias, Unset):
            logit_bias = UNSET
        elif isinstance(self.logit_bias, TraceSpansItemType2ParamsType0LogitBiasType0):
            logit_bias = self.logit_bias.to_dict()
        else:
            logit_bias = self.logit_bias

        logprobs: bool | None | Unset
        if isinstance(self.logprobs, Unset):
            logprobs = UNSET
        else:
            logprobs = self.logprobs

        top_logprobs: float | None | Unset
        if isinstance(self.top_logprobs, Unset):
            top_logprobs = UNSET
        else:
            top_logprobs = self.top_logprobs

        max_tokens: float | None | Unset
        if isinstance(self.max_tokens, Unset):
            max_tokens = UNSET
        else:
            max_tokens = self.max_tokens

        n: float | None | Unset
        if isinstance(self.n, Unset):
            n = UNSET
        else:
            n = self.n

        presence_penalty: float | None | Unset
        if isinstance(self.presence_penalty, Unset):
            presence_penalty = UNSET
        else:
            presence_penalty = self.presence_penalty

        seed: float | None | Unset
        if isinstance(self.seed, Unset):
            seed = UNSET
        else:
            seed = self.seed

        stop: list[str] | None | str | Unset
        if isinstance(self.stop, Unset):
            stop = UNSET
        elif isinstance(self.stop, list):
            stop = self.stop

        else:
            stop = self.stop

        stream: bool | None | Unset
        if isinstance(self.stream, Unset):
            stream = UNSET
        else:
            stream = self.stream

        temperature: float | None | Unset
        if isinstance(self.temperature, Unset):
            temperature = UNSET
        else:
            temperature = self.temperature

        top_p: float | None | Unset
        if isinstance(self.top_p, Unset):
            top_p = UNSET
        else:
            top_p = self.top_p

        tools: list[dict[str, Any]] | None | Unset
        if isinstance(self.tools, Unset):
            tools = UNSET
        elif isinstance(self.tools, list):
            tools = []
            for tools_type_0_item_data in self.tools:
                tools_type_0_item = tools_type_0_item_data.to_dict()
                tools.append(tools_type_0_item)

        else:
            tools = self.tools

        tool_choice: dict[str, Any] | None | str | Unset
        if isinstance(self.tool_choice, Unset):
            tool_choice = UNSET
        elif isinstance(self.tool_choice, TraceSpansItemType2ParamsType0ToolChoiceType0Type0):
            tool_choice = self.tool_choice.to_dict()
        else:
            tool_choice = self.tool_choice

        parallel_tool_calls: bool | None | Unset
        if isinstance(self.parallel_tool_calls, Unset):
            parallel_tool_calls = UNSET
        else:
            parallel_tool_calls = self.parallel_tool_calls

        functions: list[dict[str, Any]] | None | Unset
        if isinstance(self.functions, Unset):
            functions = UNSET
        elif isinstance(self.functions, list):
            functions = []
            for functions_type_0_item_data in self.functions:
                functions_type_0_item = functions_type_0_item_data.to_dict()
                functions.append(functions_type_0_item)

        else:
            functions = self.functions

        user: None | str | Unset
        if isinstance(self.user, Unset):
            user = UNSET
        else:
            user = self.user

        reasoning_effort: None | str | Unset
        if isinstance(self.reasoning_effort, Unset):
            reasoning_effort = UNSET
        else:
            reasoning_effort = self.reasoning_effort

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if frequency_penalty is not UNSET:
            field_dict["frequency_penalty"] = frequency_penalty
        if logit_bias is not UNSET:
            field_dict["logit_bias"] = logit_bias
        if logprobs is not UNSET:
            field_dict["logprobs"] = logprobs
        if top_logprobs is not UNSET:
            field_dict["top_logprobs"] = top_logprobs
        if max_tokens is not UNSET:
            field_dict["max_tokens"] = max_tokens
        if n is not UNSET:
            field_dict["n"] = n
        if presence_penalty is not UNSET:
            field_dict["presence_penalty"] = presence_penalty
        if seed is not UNSET:
            field_dict["seed"] = seed
        if stop is not UNSET:
            field_dict["stop"] = stop
        if stream is not UNSET:
            field_dict["stream"] = stream
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if top_p is not UNSET:
            field_dict["top_p"] = top_p
        if tools is not UNSET:
            field_dict["tools"] = tools
        if tool_choice is not UNSET:
            field_dict["tool_choice"] = tool_choice
        if parallel_tool_calls is not UNSET:
            field_dict["parallel_tool_calls"] = parallel_tool_calls
        if functions is not UNSET:
            field_dict["functions"] = functions
        if user is not UNSET:
            field_dict["user"] = user
        if reasoning_effort is not UNSET:
            field_dict["reasoning_effort"] = reasoning_effort

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trace_spans_item_type_2_params_type_0_functions_type_0_item import (
            TraceSpansItemType2ParamsType0FunctionsType0Item,
        )
        from ..models.trace_spans_item_type_2_params_type_0_logit_bias_type_0 import (
            TraceSpansItemType2ParamsType0LogitBiasType0,
        )
        from ..models.trace_spans_item_type_2_params_type_0_tool_choice_type_0_type_0 import (
            TraceSpansItemType2ParamsType0ToolChoiceType0Type0,
        )
        from ..models.trace_spans_item_type_2_params_type_0_tools_type_0_item import (
            TraceSpansItemType2ParamsType0ToolsType0Item,
        )

        d = dict(src_dict)

        def _parse_frequency_penalty(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        frequency_penalty = _parse_frequency_penalty(d.pop("frequency_penalty", UNSET))

        def _parse_logit_bias(data: object) -> None | TraceSpansItemType2ParamsType0LogitBiasType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                logit_bias_type_0 = TraceSpansItemType2ParamsType0LogitBiasType0.from_dict(data)

                return logit_bias_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TraceSpansItemType2ParamsType0LogitBiasType0 | Unset, data)

        logit_bias = _parse_logit_bias(d.pop("logit_bias", UNSET))

        def _parse_logprobs(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        logprobs = _parse_logprobs(d.pop("logprobs", UNSET))

        def _parse_top_logprobs(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        top_logprobs = _parse_top_logprobs(d.pop("top_logprobs", UNSET))

        def _parse_max_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        max_tokens = _parse_max_tokens(d.pop("max_tokens", UNSET))

        def _parse_n(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        n = _parse_n(d.pop("n", UNSET))

        def _parse_presence_penalty(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        presence_penalty = _parse_presence_penalty(d.pop("presence_penalty", UNSET))

        def _parse_seed(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        seed = _parse_seed(d.pop("seed", UNSET))

        def _parse_stop(data: object) -> list[str] | None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                stop_type_0_type_1 = cast(list[str], data)

                return stop_type_0_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | str | Unset, data)

        stop = _parse_stop(d.pop("stop", UNSET))

        def _parse_stream(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        stream = _parse_stream(d.pop("stream", UNSET))

        def _parse_temperature(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        temperature = _parse_temperature(d.pop("temperature", UNSET))

        def _parse_top_p(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        top_p = _parse_top_p(d.pop("top_p", UNSET))

        def _parse_tools(data: object) -> list[TraceSpansItemType2ParamsType0ToolsType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                tools_type_0 = []
                _tools_type_0 = data
                for tools_type_0_item_data in _tools_type_0:
                    tools_type_0_item = TraceSpansItemType2ParamsType0ToolsType0Item.from_dict(tools_type_0_item_data)

                    tools_type_0.append(tools_type_0_item)

                return tools_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[TraceSpansItemType2ParamsType0ToolsType0Item] | None | Unset, data)

        tools = _parse_tools(d.pop("tools", UNSET))

        def _parse_tool_choice(data: object) -> None | str | TraceSpansItemType2ParamsType0ToolChoiceType0Type0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                tool_choice_type_0_type_0 = TraceSpansItemType2ParamsType0ToolChoiceType0Type0.from_dict(data)

                return tool_choice_type_0_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | str | TraceSpansItemType2ParamsType0ToolChoiceType0Type0 | Unset, data)

        tool_choice = _parse_tool_choice(d.pop("tool_choice", UNSET))

        def _parse_parallel_tool_calls(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        parallel_tool_calls = _parse_parallel_tool_calls(d.pop("parallel_tool_calls", UNSET))

        def _parse_functions(data: object) -> list[TraceSpansItemType2ParamsType0FunctionsType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                functions_type_0 = []
                _functions_type_0 = data
                for functions_type_0_item_data in _functions_type_0:
                    functions_type_0_item = TraceSpansItemType2ParamsType0FunctionsType0Item.from_dict(
                        functions_type_0_item_data
                    )

                    functions_type_0.append(functions_type_0_item)

                return functions_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[TraceSpansItemType2ParamsType0FunctionsType0Item] | None | Unset, data)

        functions = _parse_functions(d.pop("functions", UNSET))

        def _parse_user(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        user = _parse_user(d.pop("user", UNSET))

        def _parse_reasoning_effort(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        reasoning_effort = _parse_reasoning_effort(d.pop("reasoning_effort", UNSET))

        trace_spans_item_type_2_params_type_0 = cls(
            frequency_penalty=frequency_penalty,
            logit_bias=logit_bias,
            logprobs=logprobs,
            top_logprobs=top_logprobs,
            max_tokens=max_tokens,
            n=n,
            presence_penalty=presence_penalty,
            seed=seed,
            stop=stop,
            stream=stream,
            temperature=temperature,
            top_p=top_p,
            tools=tools,
            tool_choice=tool_choice,
            parallel_tool_calls=parallel_tool_calls,
            functions=functions,
            user=user,
            reasoning_effort=reasoning_effort,
        )

        trace_spans_item_type_2_params_type_0.additional_properties = d
        return trace_spans_item_type_2_params_type_0

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
