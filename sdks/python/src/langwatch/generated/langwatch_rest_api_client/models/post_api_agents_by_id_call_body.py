from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_agents_by_id_call_body_messages_item import PostApiAgentsByIdCallBodyMessagesItem
    from ..models.post_api_agents_by_id_call_body_new_messages_item import PostApiAgentsByIdCallBodyNewMessagesItem
    from ..models.post_api_agents_by_id_call_body_params import PostApiAgentsByIdCallBodyParams
    from ..models.post_api_agents_by_id_call_body_run import PostApiAgentsByIdCallBodyRun


T = TypeVar("T", bound="PostApiAgentsByIdCallBody")


@_attrs_define
class PostApiAgentsByIdCallBody:
    """
    Attributes:
        messages (list[PostApiAgentsByIdCallBodyMessagesItem]): The whole conversation so far, OpenAI style.
        new_messages (list[PostApiAgentsByIdCallBodyNewMessagesItem] | Unset): The messages added since the agent's last
            turn. Defaults to the last message.
        thread_id (str | Unset): The conversation id. Turns of one conversation share it; a new id starts a new one.
        params (PostApiAgentsByIdCallBodyParams | Unset): Run parameter values by name, as JSON scalars.
        session (Any | Unset): The session the agent returned on its previous turn of this conversation, echoed back as
            is.
        traceparent (str | Unset): The W3C trace context the agent adopts, so its spans join this turn's trace.
        run (PostApiAgentsByIdCallBodyRun | Unset): The simulation run this turn belongs to, if any.
    """

    messages: list[PostApiAgentsByIdCallBodyMessagesItem]
    new_messages: list[PostApiAgentsByIdCallBodyNewMessagesItem] | Unset = UNSET
    thread_id: str | Unset = UNSET
    params: PostApiAgentsByIdCallBodyParams | Unset = UNSET
    session: Any | Unset = UNSET
    traceparent: str | Unset = UNSET
    run: PostApiAgentsByIdCallBodyRun | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_agents_by_id_call_body_messages_item import PostApiAgentsByIdCallBodyMessagesItem
        from ..models.post_api_agents_by_id_call_body_new_messages_item import PostApiAgentsByIdCallBodyNewMessagesItem
        from ..models.post_api_agents_by_id_call_body_params import PostApiAgentsByIdCallBodyParams
        from ..models.post_api_agents_by_id_call_body_run import PostApiAgentsByIdCallBodyRun

        d = dict(src_dict)
        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = PostApiAgentsByIdCallBodyMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        _new_messages = d.pop("newMessages", UNSET)
        new_messages: list[PostApiAgentsByIdCallBodyNewMessagesItem] | Unset = UNSET
        if _new_messages is not UNSET:
            new_messages = []
            for new_messages_item_data in _new_messages:
                new_messages_item = PostApiAgentsByIdCallBodyNewMessagesItem.from_dict(new_messages_item_data)

                new_messages.append(new_messages_item)

        thread_id = d.pop("threadId", UNSET)

        _params = d.pop("params", UNSET)
        params: PostApiAgentsByIdCallBodyParams | Unset
        if isinstance(_params, Unset):
            params = UNSET
        else:
            params = PostApiAgentsByIdCallBodyParams.from_dict(_params)

        session = d.pop("session", UNSET)

        traceparent = d.pop("traceparent", UNSET)

        _run = d.pop("run", UNSET)
        run: PostApiAgentsByIdCallBodyRun | Unset
        if isinstance(_run, Unset):
            run = UNSET
        else:
            run = PostApiAgentsByIdCallBodyRun.from_dict(_run)

        post_api_agents_by_id_call_body = cls(
            messages=messages,
            new_messages=new_messages,
            thread_id=thread_id,
            params=params,
            session=session,
            traceparent=traceparent,
            run=run,
        )

        post_api_agents_by_id_call_body.additional_properties = d
        return post_api_agents_by_id_call_body

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
