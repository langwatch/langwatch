from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiCodingAgentSessionsBySessionIdEventsResponse200EventsItem")


@_attrs_define
class GetApiCodingAgentSessionsBySessionIdEventsResponse200EventsItem:
    """
    Attributes:
        session_id (str):
        time_unix_ms (float):
        record_id (str):
        event_kind (str):
        agent (str):
        session_key_source (str):
        trace_id (str):
        span_id (str):
        prompt_id (str):
        query_source (str):
        agent_type (str):
        event_sequence (float):
        request_id (str):
        model (str):
        input_tokens (float):
        output_tokens (float):
        cache_read_tokens (float):
        cache_creation_tokens (float):
        cost_usd (float):
        duration_ms (float):
        ttft_ms (float):
        attempt (float):
        speed (str):
        stop_reason (str):
        pre_tokens (float):
        post_tokens (float):
        compaction_trigger (str):
        precompute_reuse (str):
        status_code (str):
        error_type (str):
        rate_limit_carrier (str):
        retry_duration_ms (float):
        tool_name (str):
        success (str):
        decision (str):
        decision_source (str):
        tool_input_bytes (float):
        tool_result_bytes (float):
        prompt_chars (float):
        total_tokens (float):
    """

    session_id: str
    time_unix_ms: float
    record_id: str
    event_kind: str
    agent: str
    session_key_source: str
    trace_id: str
    span_id: str
    prompt_id: str
    query_source: str
    agent_type: str
    event_sequence: float
    request_id: str
    model: str
    input_tokens: float
    output_tokens: float
    cache_read_tokens: float
    cache_creation_tokens: float
    cost_usd: float
    duration_ms: float
    ttft_ms: float
    attempt: float
    speed: str
    stop_reason: str
    pre_tokens: float
    post_tokens: float
    compaction_trigger: str
    precompute_reuse: str
    status_code: str
    error_type: str
    rate_limit_carrier: str
    retry_duration_ms: float
    tool_name: str
    success: str
    decision: str
    decision_source: str
    tool_input_bytes: float
    tool_result_bytes: float
    prompt_chars: float
    total_tokens: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        time_unix_ms = self.time_unix_ms

        record_id = self.record_id

        event_kind = self.event_kind

        agent = self.agent

        session_key_source = self.session_key_source

        trace_id = self.trace_id

        span_id = self.span_id

        prompt_id = self.prompt_id

        query_source = self.query_source

        agent_type = self.agent_type

        event_sequence = self.event_sequence

        request_id = self.request_id

        model = self.model

        input_tokens = self.input_tokens

        output_tokens = self.output_tokens

        cache_read_tokens = self.cache_read_tokens

        cache_creation_tokens = self.cache_creation_tokens

        cost_usd = self.cost_usd

        duration_ms = self.duration_ms

        ttft_ms = self.ttft_ms

        attempt = self.attempt

        speed = self.speed

        stop_reason = self.stop_reason

        pre_tokens = self.pre_tokens

        post_tokens = self.post_tokens

        compaction_trigger = self.compaction_trigger

        precompute_reuse = self.precompute_reuse

        status_code = self.status_code

        error_type = self.error_type

        rate_limit_carrier = self.rate_limit_carrier

        retry_duration_ms = self.retry_duration_ms

        tool_name = self.tool_name

        success = self.success

        decision = self.decision

        decision_source = self.decision_source

        tool_input_bytes = self.tool_input_bytes

        tool_result_bytes = self.tool_result_bytes

        prompt_chars = self.prompt_chars

        total_tokens = self.total_tokens

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionId": session_id,
                "timeUnixMs": time_unix_ms,
                "recordId": record_id,
                "eventKind": event_kind,
                "agent": agent,
                "sessionKeySource": session_key_source,
                "traceId": trace_id,
                "spanId": span_id,
                "promptId": prompt_id,
                "querySource": query_source,
                "agentType": agent_type,
                "eventSequence": event_sequence,
                "requestId": request_id,
                "model": model,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "cacheReadTokens": cache_read_tokens,
                "cacheCreationTokens": cache_creation_tokens,
                "costUsd": cost_usd,
                "durationMs": duration_ms,
                "ttftMs": ttft_ms,
                "attempt": attempt,
                "speed": speed,
                "stopReason": stop_reason,
                "preTokens": pre_tokens,
                "postTokens": post_tokens,
                "compactionTrigger": compaction_trigger,
                "precomputeReuse": precompute_reuse,
                "statusCode": status_code,
                "errorType": error_type,
                "rateLimitCarrier": rate_limit_carrier,
                "retryDurationMs": retry_duration_ms,
                "toolName": tool_name,
                "success": success,
                "decision": decision,
                "decisionSource": decision_source,
                "toolInputBytes": tool_input_bytes,
                "toolResultBytes": tool_result_bytes,
                "promptChars": prompt_chars,
                "totalTokens": total_tokens,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionId")

        time_unix_ms = d.pop("timeUnixMs")

        record_id = d.pop("recordId")

        event_kind = d.pop("eventKind")

        agent = d.pop("agent")

        session_key_source = d.pop("sessionKeySource")

        trace_id = d.pop("traceId")

        span_id = d.pop("spanId")

        prompt_id = d.pop("promptId")

        query_source = d.pop("querySource")

        agent_type = d.pop("agentType")

        event_sequence = d.pop("eventSequence")

        request_id = d.pop("requestId")

        model = d.pop("model")

        input_tokens = d.pop("inputTokens")

        output_tokens = d.pop("outputTokens")

        cache_read_tokens = d.pop("cacheReadTokens")

        cache_creation_tokens = d.pop("cacheCreationTokens")

        cost_usd = d.pop("costUsd")

        duration_ms = d.pop("durationMs")

        ttft_ms = d.pop("ttftMs")

        attempt = d.pop("attempt")

        speed = d.pop("speed")

        stop_reason = d.pop("stopReason")

        pre_tokens = d.pop("preTokens")

        post_tokens = d.pop("postTokens")

        compaction_trigger = d.pop("compactionTrigger")

        precompute_reuse = d.pop("precomputeReuse")

        status_code = d.pop("statusCode")

        error_type = d.pop("errorType")

        rate_limit_carrier = d.pop("rateLimitCarrier")

        retry_duration_ms = d.pop("retryDurationMs")

        tool_name = d.pop("toolName")

        success = d.pop("success")

        decision = d.pop("decision")

        decision_source = d.pop("decisionSource")

        tool_input_bytes = d.pop("toolInputBytes")

        tool_result_bytes = d.pop("toolResultBytes")

        prompt_chars = d.pop("promptChars")

        total_tokens = d.pop("totalTokens")

        get_api_coding_agent_sessions_by_session_id_events_response_200_events_item = cls(
            session_id=session_id,
            time_unix_ms=time_unix_ms,
            record_id=record_id,
            event_kind=event_kind,
            agent=agent,
            session_key_source=session_key_source,
            trace_id=trace_id,
            span_id=span_id,
            prompt_id=prompt_id,
            query_source=query_source,
            agent_type=agent_type,
            event_sequence=event_sequence,
            request_id=request_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_creation_tokens=cache_creation_tokens,
            cost_usd=cost_usd,
            duration_ms=duration_ms,
            ttft_ms=ttft_ms,
            attempt=attempt,
            speed=speed,
            stop_reason=stop_reason,
            pre_tokens=pre_tokens,
            post_tokens=post_tokens,
            compaction_trigger=compaction_trigger,
            precompute_reuse=precompute_reuse,
            status_code=status_code,
            error_type=error_type,
            rate_limit_carrier=rate_limit_carrier,
            retry_duration_ms=retry_duration_ms,
            tool_name=tool_name,
            success=success,
            decision=decision,
            decision_source=decision_source,
            tool_input_bytes=tool_input_bytes,
            tool_result_bytes=tool_result_bytes,
            prompt_chars=prompt_chars,
            total_tokens=total_tokens,
        )

        get_api_coding_agent_sessions_by_session_id_events_response_200_events_item.additional_properties = d
        return get_api_coding_agent_sessions_by_session_id_events_response_200_events_item

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
