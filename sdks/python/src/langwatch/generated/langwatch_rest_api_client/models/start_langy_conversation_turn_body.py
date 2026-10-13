from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.start_langy_conversation_turn_body_messages_item import StartLangyConversationTurnBodyMessagesItem


T = TypeVar("T", bound="StartLangyConversationTurnBody")


@_attrs_define
class StartLangyConversationTurnBody:
    """
    Attributes:
        messages (list[StartLangyConversationTurnBodyMessagesItem]):
        idempotency_key (str):
        model_override (str | Unset):
        adopt_conversation_id (bool | Unset):
    """

    messages: list[StartLangyConversationTurnBodyMessagesItem]
    idempotency_key: str
    model_override: str | Unset = UNSET
    adopt_conversation_id: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        idempotency_key = self.idempotency_key

        model_override = self.model_override

        adopt_conversation_id = self.adopt_conversation_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "messages": messages,
                "idempotencyKey": idempotency_key,
            }
        )
        if model_override is not UNSET:
            field_dict["modelOverride"] = model_override
        if adopt_conversation_id is not UNSET:
            field_dict["adoptConversationId"] = adopt_conversation_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.start_langy_conversation_turn_body_messages_item import StartLangyConversationTurnBodyMessagesItem

        d = dict(src_dict)
        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = StartLangyConversationTurnBodyMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        idempotency_key = d.pop("idempotencyKey")

        model_override = d.pop("modelOverride", UNSET)

        adopt_conversation_id = d.pop("adoptConversationId", UNSET)

        start_langy_conversation_turn_body = cls(
            messages=messages,
            idempotency_key=idempotency_key,
            model_override=model_override,
            adopt_conversation_id=adopt_conversation_id,
        )

        start_langy_conversation_turn_body.additional_properties = d
        return start_langy_conversation_turn_body

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
