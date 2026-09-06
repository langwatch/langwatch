from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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


T = TypeVar("T", bound="PollConnectedAgentInstanceResponse200FramesItemType0")


@_attrs_define
class PollConnectedAgentInstanceResponse200FramesItemType0:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['call']):
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
    session: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

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

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
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

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["call"], d.pop("type"))
        if type_ != "call":
            raise ValueError(f"type must match const 'call', got '{type_}'")

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

        poll_connected_agent_instance_response_200_frames_item_type_0 = cls(
            protocol=protocol,
            type_=type_,
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
        )

        poll_connected_agent_instance_response_200_frames_item_type_0.additional_properties = d
        return poll_connected_agent_instance_response_200_frames_item_type_0

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
