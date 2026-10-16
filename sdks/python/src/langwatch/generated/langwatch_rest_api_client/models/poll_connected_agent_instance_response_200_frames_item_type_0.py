from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_kind import (
    PollConnectedAgentInstanceResponse200FramesItemType0Kind,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_messages_item import (
        PollConnectedAgentInstanceResponse200FramesItemType0MessagesItem,
    )
    from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_new_messages_item import (
        PollConnectedAgentInstanceResponse200FramesItemType0NewMessagesItem,
    )
    from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_params import (
        PollConnectedAgentInstanceResponse200FramesItemType0Params,
    )
    from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_run import (
        PollConnectedAgentInstanceResponse200FramesItemType0Run,
    )
    from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_state_type_0 import (
        PollConnectedAgentInstanceResponse200FramesItemType0StateType0,
    )


T = TypeVar("T", bound="PollConnectedAgentInstanceResponse200FramesItemType0")


@_attrs_define
class PollConnectedAgentInstanceResponse200FramesItemType0:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['call']):
        kind (PollConnectedAgentInstanceResponse200FramesItemType0Kind):  Default:
            PollConnectedAgentInstanceResponse200FramesItemType0Kind.TURN.
        call_id (str):
        agent_id (str):
        thread_id (str):
        messages (list[PollConnectedAgentInstanceResponse200FramesItemType0MessagesItem]):
        new_messages (list[PollConnectedAgentInstanceResponse200FramesItemType0NewMessagesItem]):
        params (PollConnectedAgentInstanceResponse200FramesItemType0Params):
        traceparent (None | str):
        deadline_at (int):
        run (PollConnectedAgentInstanceResponse200FramesItemType0Run):
        session (Any | Unset):
        state (None | PollConnectedAgentInstanceResponse200FramesItemType0StateType0 | Unset):
    """

    protocol: Literal[1]
    type_: Literal["call"]
    call_id: str
    agent_id: str
    thread_id: str
    messages: list[PollConnectedAgentInstanceResponse200FramesItemType0MessagesItem]
    new_messages: list[PollConnectedAgentInstanceResponse200FramesItemType0NewMessagesItem]
    params: PollConnectedAgentInstanceResponse200FramesItemType0Params
    traceparent: None | str
    deadline_at: int
    run: PollConnectedAgentInstanceResponse200FramesItemType0Run
    kind: PollConnectedAgentInstanceResponse200FramesItemType0Kind = (
        PollConnectedAgentInstanceResponse200FramesItemType0Kind.TURN
    )
    session: Any | Unset = UNSET
    state: None | PollConnectedAgentInstanceResponse200FramesItemType0StateType0 | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_state_type_0 import (
            PollConnectedAgentInstanceResponse200FramesItemType0StateType0,
        )

        protocol = self.protocol

        type_ = self.type_

        kind = self.kind.value

        call_id = self.call_id

        agent_id = self.agent_id

        thread_id = self.thread_id

        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        new_messages = []
        for new_messages_item_data in self.new_messages:
            new_messages_item = new_messages_item_data.to_dict()
            new_messages.append(new_messages_item)

        params = self.params.to_dict()

        traceparent: None | str
        traceparent = self.traceparent

        deadline_at = self.deadline_at

        run = self.run.to_dict()

        session = self.session

        state: dict[str, Any] | None | Unset
        if isinstance(self.state, Unset):
            state = UNSET
        elif isinstance(self.state, PollConnectedAgentInstanceResponse200FramesItemType0StateType0):
            state = self.state.to_dict()
        else:
            state = self.state

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "kind": kind,
                "callId": call_id,
                "agentId": agent_id,
                "threadId": thread_id,
                "messages": messages,
                "newMessages": new_messages,
                "params": params,
                "traceparent": traceparent,
                "deadlineAt": deadline_at,
                "run": run,
            }
        )
        if session is not UNSET:
            field_dict["session"] = session
        if state is not UNSET:
            field_dict["state"] = state

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_messages_item import (
            PollConnectedAgentInstanceResponse200FramesItemType0MessagesItem,
        )
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_new_messages_item import (
            PollConnectedAgentInstanceResponse200FramesItemType0NewMessagesItem,
        )
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_params import (
            PollConnectedAgentInstanceResponse200FramesItemType0Params,
        )
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_run import (
            PollConnectedAgentInstanceResponse200FramesItemType0Run,
        )
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_0_state_type_0 import (
            PollConnectedAgentInstanceResponse200FramesItemType0StateType0,
        )

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["call"], d.pop("type"))
        if type_ != "call":
            raise ValueError(f"type must match const 'call', got '{type_}'")

        kind = PollConnectedAgentInstanceResponse200FramesItemType0Kind(d.pop("kind"))

        call_id = d.pop("callId")

        agent_id = d.pop("agentId")

        thread_id = d.pop("threadId")

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = PollConnectedAgentInstanceResponse200FramesItemType0MessagesItem.from_dict(
                messages_item_data
            )

            messages.append(messages_item)

        new_messages = []
        _new_messages = d.pop("newMessages")
        for new_messages_item_data in _new_messages:
            new_messages_item = PollConnectedAgentInstanceResponse200FramesItemType0NewMessagesItem.from_dict(
                new_messages_item_data
            )

            new_messages.append(new_messages_item)

        params = PollConnectedAgentInstanceResponse200FramesItemType0Params.from_dict(d.pop("params"))

        def _parse_traceparent(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        traceparent = _parse_traceparent(d.pop("traceparent"))

        deadline_at = d.pop("deadlineAt")

        run = PollConnectedAgentInstanceResponse200FramesItemType0Run.from_dict(d.pop("run"))

        session = d.pop("session", UNSET)

        def _parse_state(data: object) -> None | PollConnectedAgentInstanceResponse200FramesItemType0StateType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                state_type_0 = PollConnectedAgentInstanceResponse200FramesItemType0StateType0.from_dict(data)

                return state_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PollConnectedAgentInstanceResponse200FramesItemType0StateType0 | Unset, data)

        state = _parse_state(d.pop("state", UNSET))

        poll_connected_agent_instance_response_200_frames_item_type_0 = cls(
            protocol=protocol,
            type_=type_,
            kind=kind,
            call_id=call_id,
            agent_id=agent_id,
            thread_id=thread_id,
            messages=messages,
            new_messages=new_messages,
            params=params,
            traceparent=traceparent,
            deadline_at=deadline_at,
            run=run,
            session=session,
            state=state,
        )

        return poll_connected_agent_instance_response_200_frames_item_type_0
