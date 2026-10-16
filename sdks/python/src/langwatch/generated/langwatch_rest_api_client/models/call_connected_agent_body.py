from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.call_connected_agent_body_kind import CallConnectedAgentBodyKind
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.call_connected_agent_body_messages_item import CallConnectedAgentBodyMessagesItem
    from ..models.call_connected_agent_body_new_messages_item import CallConnectedAgentBodyNewMessagesItem
    from ..models.call_connected_agent_body_params import CallConnectedAgentBodyParams
    from ..models.call_connected_agent_body_run import CallConnectedAgentBodyRun
    from ..models.call_connected_agent_body_state_type_0 import CallConnectedAgentBodyStateType0


T = TypeVar("T", bound="CallConnectedAgentBody")


@_attrs_define
class CallConnectedAgentBody:
    """
    Attributes:
        messages (list[CallConnectedAgentBodyMessagesItem]): The whole conversation so far, OpenAI style.
        new_messages (list[CallConnectedAgentBodyNewMessagesItem] | Unset): The messages added since the agent's last
            turn. Defaults to the last message.
        thread_id (str | Unset): The conversation id. Turns of one conversation share it; a new id starts a new one.
        params (CallConnectedAgentBodyParams | Unset): Run parameter values by name, as JSON scalars.
        session (Any | Unset): The session the agent returned on its previous turn of this conversation, echoed back as
            is.
        traceparent (str | Unset): The W3C trace context the agent adopts, so its spans join this turn's trace.
        run (CallConnectedAgentBodyRun | Unset): The simulation run this turn belongs to, if any.
        kind (CallConnectedAgentBodyKind | Unset): A turn, or a scenario run's setup or teardown hook. Defaults to a
            turn.
        state (CallConnectedAgentBodyStateType0 | None | Unset): The scenario run's test data: what setup returned, or a
            turn's latest update.
        timeout_ms (int | Unset): A setup or teardown hook's budget in milliseconds. A turn runs under the agent's own
            timeout.
    """

    messages: list[CallConnectedAgentBodyMessagesItem]
    new_messages: list[CallConnectedAgentBodyNewMessagesItem] | Unset = UNSET
    thread_id: str | Unset = UNSET
    params: CallConnectedAgentBodyParams | Unset = UNSET
    session: Any | Unset = UNSET
    traceparent: str | Unset = UNSET
    run: CallConnectedAgentBodyRun | Unset = UNSET
    kind: CallConnectedAgentBodyKind | Unset = UNSET
    state: CallConnectedAgentBodyStateType0 | None | Unset = UNSET
    timeout_ms: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.call_connected_agent_body_state_type_0 import CallConnectedAgentBodyStateType0

        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        new_messages: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.new_messages, Unset):
            new_messages = []
            for new_messages_item_data in self.new_messages:
                new_messages_item = new_messages_item_data.to_dict()
                new_messages.append(new_messages_item)

        thread_id = self.thread_id

        params: dict[str, Any] | Unset = UNSET
        if not isinstance(self.params, Unset):
            params = self.params.to_dict()

        session = self.session

        traceparent = self.traceparent

        run: dict[str, Any] | Unset = UNSET
        if not isinstance(self.run, Unset):
            run = self.run.to_dict()

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind.value

        state: dict[str, Any] | None | Unset
        if isinstance(self.state, Unset):
            state = UNSET
        elif isinstance(self.state, CallConnectedAgentBodyStateType0):
            state = self.state.to_dict()
        else:
            state = self.state

        timeout_ms = self.timeout_ms

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "messages": messages,
            }
        )
        if new_messages is not UNSET:
            field_dict["newMessages"] = new_messages
        if thread_id is not UNSET:
            field_dict["threadId"] = thread_id
        if params is not UNSET:
            field_dict["params"] = params
        if session is not UNSET:
            field_dict["session"] = session
        if traceparent is not UNSET:
            field_dict["traceparent"] = traceparent
        if run is not UNSET:
            field_dict["run"] = run
        if kind is not UNSET:
            field_dict["kind"] = kind
        if state is not UNSET:
            field_dict["state"] = state
        if timeout_ms is not UNSET:
            field_dict["timeoutMs"] = timeout_ms

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.call_connected_agent_body_messages_item import CallConnectedAgentBodyMessagesItem
        from ..models.call_connected_agent_body_new_messages_item import CallConnectedAgentBodyNewMessagesItem
        from ..models.call_connected_agent_body_params import CallConnectedAgentBodyParams
        from ..models.call_connected_agent_body_run import CallConnectedAgentBodyRun
        from ..models.call_connected_agent_body_state_type_0 import CallConnectedAgentBodyStateType0

        d = dict(src_dict)
        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = CallConnectedAgentBodyMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        _new_messages = d.pop("newMessages", UNSET)
        new_messages: list[CallConnectedAgentBodyNewMessagesItem] | Unset = UNSET
        if _new_messages is not UNSET:
            new_messages = []
            for new_messages_item_data in _new_messages:
                new_messages_item = CallConnectedAgentBodyNewMessagesItem.from_dict(new_messages_item_data)

                new_messages.append(new_messages_item)

        thread_id = d.pop("threadId", UNSET)

        _params = d.pop("params", UNSET)
        params: CallConnectedAgentBodyParams | Unset
        if isinstance(_params, Unset):
            params = UNSET
        else:
            params = CallConnectedAgentBodyParams.from_dict(_params)

        session = d.pop("session", UNSET)

        traceparent = d.pop("traceparent", UNSET)

        _run = d.pop("run", UNSET)
        run: CallConnectedAgentBodyRun | Unset
        if isinstance(_run, Unset):
            run = UNSET
        else:
            run = CallConnectedAgentBodyRun.from_dict(_run)

        _kind = d.pop("kind", UNSET)
        kind: CallConnectedAgentBodyKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = CallConnectedAgentBodyKind(_kind)

        def _parse_state(data: object) -> CallConnectedAgentBodyStateType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                state_type_0 = CallConnectedAgentBodyStateType0.from_dict(data)

                return state_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(CallConnectedAgentBodyStateType0 | None | Unset, data)

        state = _parse_state(d.pop("state", UNSET))

        timeout_ms = d.pop("timeoutMs", UNSET)

        call_connected_agent_body = cls(
            messages=messages,
            new_messages=new_messages,
            thread_id=thread_id,
            params=params,
            session=session,
            traceparent=traceparent,
            run=run,
            kind=kind,
            state=state,
            timeout_ms=timeout_ms,
        )

        call_connected_agent_body.additional_properties = d
        return call_connected_agent_body

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
