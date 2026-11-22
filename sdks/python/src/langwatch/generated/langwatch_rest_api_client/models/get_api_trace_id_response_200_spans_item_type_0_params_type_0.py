from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_functions_type_0_item import (
        GetApiTraceIdResponse200SpansItemType0ParamsType0FunctionsType0Item,
    )
    from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_logit_bias_type_0 import (
        GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0,
    )
    from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_tool_choice_type_0_type_0 import (
        GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0,
    )
    from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_tools_type_0_item import (
        GetApiTraceIdResponse200SpansItemType0ParamsType0ToolsType0Item,
    )


T = TypeVar("T", bound="GetApiTraceIdResponse200SpansItemType0ParamsType0")


@_attrs_define
class GetApiTraceIdResponse200SpansItemType0ParamsType0:
    """
    Attributes:
        frequency_penalty (Any | float | None | Unset):
        logit_bias (Any | GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0 | None | Unset):
        logprobs (Any | bool | None | Unset):
        top_logprobs (Any | float | None | Unset):
        max_tokens (Any | float | None | Unset):
        n (Any | float | None | Unset):
        presence_penalty (Any | float | None | Unset):
        seed (Any | float | None | Unset):
        stop (Any | list[str] | None | str | Unset):
        stream (Any | bool | None | Unset):
        temperature (Any | float | None | Unset):
        top_p (Any | float | None | Unset):
        tools (Any | list[GetApiTraceIdResponse200SpansItemType0ParamsType0ToolsType0Item] | None | Unset):
        tool_choice (Any | GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0 | None | str | Unset):
        parallel_tool_calls (Any | bool | None | Unset):
        functions (Any | list[GetApiTraceIdResponse200SpansItemType0ParamsType0FunctionsType0Item] | None | Unset):
        user (Any | None | str | Unset):
        reasoning_effort (Any | None | str | Unset):
    """

    frequency_penalty: Any | float | None | Unset = UNSET
    logit_bias: Any | GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0 | None | Unset = UNSET
    logprobs: Any | bool | None | Unset = UNSET
    top_logprobs: Any | float | None | Unset = UNSET
    max_tokens: Any | float | None | Unset = UNSET
    n: Any | float | None | Unset = UNSET
    presence_penalty: Any | float | None | Unset = UNSET
    seed: Any | float | None | Unset = UNSET
    stop: Any | list[str] | None | str | Unset = UNSET
    stream: Any | bool | None | Unset = UNSET
    temperature: Any | float | None | Unset = UNSET
    top_p: Any | float | None | Unset = UNSET
    tools: Any | list[GetApiTraceIdResponse200SpansItemType0ParamsType0ToolsType0Item] | None | Unset = UNSET
    tool_choice: Any | GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0 | None | str | Unset = (
        UNSET
    )
    parallel_tool_calls: Any | bool | None | Unset = UNSET
    functions: Any | list[GetApiTraceIdResponse200SpansItemType0ParamsType0FunctionsType0Item] | None | Unset = UNSET
    user: Any | None | str | Unset = UNSET
    reasoning_effort: Any | None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_logit_bias_type_0 import (
            GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0,
        )
        from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_tool_choice_type_0_type_0 import (
            GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0,
        )

        frequency_penalty: Any | float | None | Unset
        if isinstance(self.frequency_penalty, Unset):
            frequency_penalty = UNSET
        else:
            frequency_penalty = self.frequency_penalty

        logit_bias: Any | dict[str, Any] | None | Unset
        if isinstance(self.logit_bias, Unset):
            logit_bias = UNSET
        elif isinstance(self.logit_bias, GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0):
            logit_bias = self.logit_bias.to_dict()
        else:
            logit_bias = self.logit_bias

        logprobs: Any | bool | None | Unset
        if isinstance(self.logprobs, Unset):
            logprobs = UNSET
        else:
            logprobs = self.logprobs

        top_logprobs: Any | float | None | Unset
        if isinstance(self.top_logprobs, Unset):
            top_logprobs = UNSET
        else:
            top_logprobs = self.top_logprobs

        max_tokens: Any | float | None | Unset
        if isinstance(self.max_tokens, Unset):
            max_tokens = UNSET
        else:
            max_tokens = self.max_tokens

        n: Any | float | None | Unset
        if isinstance(self.n, Unset):
            n = UNSET
        else:
            n = self.n

        presence_penalty: Any | float | None | Unset
        if isinstance(self.presence_penalty, Unset):
            presence_penalty = UNSET
        else:
            presence_penalty = self.presence_penalty

        seed: Any | float | None | Unset
        if isinstance(self.seed, Unset):
            seed = UNSET
        else:
            seed = self.seed

        stop: Any | list[str] | None | str | Unset
        if isinstance(self.stop, Unset):
            stop = UNSET
        elif isinstance(self.stop, list):
            stop = self.stop

        else:
            stop = self.stop

        stream: Any | bool | None | Unset
        if isinstance(self.stream, Unset):
            stream = UNSET
        else:
            stream = self.stream

        temperature: Any | float | None | Unset
        if isinstance(self.temperature, Unset):
            temperature = UNSET
        else:
            temperature = self.temperature

        top_p: Any | float | None | Unset
        if isinstance(self.top_p, Unset):
            top_p = UNSET
        else:
            top_p = self.top_p

        tools: Any | list[dict[str, Any]] | None | Unset
        if isinstance(self.tools, Unset):
            tools = UNSET
        elif isinstance(self.tools, list):
            tools = []
            for tools_type_0_item_data in self.tools:
                tools_type_0_item = tools_type_0_item_data.to_dict()
                tools.append(tools_type_0_item)

        else:
            tools = self.tools

        tool_choice: Any | dict[str, Any] | None | str | Unset
        if isinstance(self.tool_choice, Unset):
            tool_choice = UNSET
        elif isinstance(self.tool_choice, GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0):
            tool_choice = self.tool_choice.to_dict()
        else:
            tool_choice = self.tool_choice

        parallel_tool_calls: Any | bool | None | Unset
        if isinstance(self.parallel_tool_calls, Unset):
            parallel_tool_calls = UNSET
        else:
            parallel_tool_calls = self.parallel_tool_calls

        functions: Any | list[dict[str, Any]] | None | Unset
        if isinstance(self.functions, Unset):
            functions = UNSET
        elif isinstance(self.functions, list):
            functions = []
            for functions_type_0_item_data in self.functions:
                functions_type_0_item = functions_type_0_item_data.to_dict()
                functions.append(functions_type_0_item)

        else:
            functions = self.functions

        user: Any | None | str | Unset
        if isinstance(self.user, Unset):
            user = UNSET
        else:
            user = self.user

        reasoning_effort: Any | None | str | Unset
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
        from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_functions_type_0_item import (
            GetApiTraceIdResponse200SpansItemType0ParamsType0FunctionsType0Item,
        )
        from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_logit_bias_type_0 import (
            GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0,
        )
        from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_tool_choice_type_0_type_0 import (
            GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0,
        )
        from ..models.get_api_trace_id_response_200_spans_item_type_0_params_type_0_tools_type_0_item import (
            GetApiTraceIdResponse200SpansItemType0ParamsType0ToolsType0Item,
        )

        d = dict(src_dict)

        def _parse_frequency_penalty(data: object) -> Any | float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | float | None | Unset, data)

        frequency_penalty = _parse_frequency_penalty(d.pop("frequency_penalty", UNSET))

        def _parse_logit_bias(
            data: object,
        ) -> Any | GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                logit_bias_type_0 = GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0.from_dict(data)

                return logit_bias_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(Any | GetApiTraceIdResponse200SpansItemType0ParamsType0LogitBiasType0 | None | Unset, data)

        logit_bias = _parse_logit_bias(d.pop("logit_bias", UNSET))

        def _parse_logprobs(data: object) -> Any | bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | bool | None | Unset, data)

        logprobs = _parse_logprobs(d.pop("logprobs", UNSET))

        def _parse_top_logprobs(data: object) -> Any | float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | float | None | Unset, data)

        top_logprobs = _parse_top_logprobs(d.pop("top_logprobs", UNSET))

        def _parse_max_tokens(data: object) -> Any | float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | float | None | Unset, data)

        max_tokens = _parse_max_tokens(d.pop("max_tokens", UNSET))

        def _parse_n(data: object) -> Any | float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | float | None | Unset, data)

        n = _parse_n(d.pop("n", UNSET))

        def _parse_presence_penalty(data: object) -> Any | float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | float | None | Unset, data)

        presence_penalty = _parse_presence_penalty(d.pop("presence_penalty", UNSET))

        def _parse_seed(data: object) -> Any | float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | float | None | Unset, data)

        seed = _parse_seed(d.pop("seed", UNSET))

        def _parse_stop(data: object) -> Any | list[str] | None | str | Unset:
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
            return cast(Any | list[str] | None | str | Unset, data)

        stop = _parse_stop(d.pop("stop", UNSET))

        def _parse_stream(data: object) -> Any | bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | bool | None | Unset, data)

        stream = _parse_stream(d.pop("stream", UNSET))

        def _parse_temperature(data: object) -> Any | float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | float | None | Unset, data)

        temperature = _parse_temperature(d.pop("temperature", UNSET))

        def _parse_top_p(data: object) -> Any | float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | float | None | Unset, data)

        top_p = _parse_top_p(d.pop("top_p", UNSET))

        def _parse_tools(
            data: object,
        ) -> Any | list[GetApiTraceIdResponse200SpansItemType0ParamsType0ToolsType0Item] | None | Unset:
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
                    tools_type_0_item = GetApiTraceIdResponse200SpansItemType0ParamsType0ToolsType0Item.from_dict(
                        tools_type_0_item_data
                    )

                    tools_type_0.append(tools_type_0_item)

                return tools_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                Any | list[GetApiTraceIdResponse200SpansItemType0ParamsType0ToolsType0Item] | None | Unset, data
            )

        tools = _parse_tools(d.pop("tools", UNSET))

        def _parse_tool_choice(
            data: object,
        ) -> Any | GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0 | None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                tool_choice_type_0_type_0 = (
                    GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0.from_dict(data)
                )

                return tool_choice_type_0_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                Any | GetApiTraceIdResponse200SpansItemType0ParamsType0ToolChoiceType0Type0 | None | str | Unset, data
            )

        tool_choice = _parse_tool_choice(d.pop("tool_choice", UNSET))

        def _parse_parallel_tool_calls(data: object) -> Any | bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | bool | None | Unset, data)

        parallel_tool_calls = _parse_parallel_tool_calls(d.pop("parallel_tool_calls", UNSET))

        def _parse_functions(
            data: object,
        ) -> Any | list[GetApiTraceIdResponse200SpansItemType0ParamsType0FunctionsType0Item] | None | Unset:
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
                    functions_type_0_item = (
                        GetApiTraceIdResponse200SpansItemType0ParamsType0FunctionsType0Item.from_dict(
                            functions_type_0_item_data
                        )
                    )

                    functions_type_0.append(functions_type_0_item)

                return functions_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                Any | list[GetApiTraceIdResponse200SpansItemType0ParamsType0FunctionsType0Item] | None | Unset, data
            )

        functions = _parse_functions(d.pop("functions", UNSET))

        def _parse_user(data: object) -> Any | None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | None | str | Unset, data)

        user = _parse_user(d.pop("user", UNSET))

        def _parse_reasoning_effort(data: object) -> Any | None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | None | str | Unset, data)

        reasoning_effort = _parse_reasoning_effort(d.pop("reasoning_effort", UNSET))

        get_api_trace_id_response_200_spans_item_type_0_params_type_0 = cls(
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

        get_api_trace_id_response_200_spans_item_type_0_params_type_0.additional_properties = d
        return get_api_trace_id_response_200_spans_item_type_0_params_type_0

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
