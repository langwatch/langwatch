from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.start_langy_conversation_turn_body_messages_item_role import (
    StartLangyConversationTurnBodyMessagesItemRole,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.start_langy_conversation_turn_body_messages_item_parts_item import (
        StartLangyConversationTurnBodyMessagesItemPartsItem,
    )


T = TypeVar("T", bound="StartLangyConversationTurnBodyMessagesItem")


@_attrs_define
class StartLangyConversationTurnBodyMessagesItem:
    """
    Attributes:
        role (StartLangyConversationTurnBodyMessagesItemRole):
        parts (list[StartLangyConversationTurnBodyMessagesItemPartsItem] | Unset):
        content (str | Unset):
    """

    role: StartLangyConversationTurnBodyMessagesItemRole
    parts: list[StartLangyConversationTurnBodyMessagesItemPartsItem] | Unset = UNSET
    content: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        parts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.parts, Unset):
            parts = []
            for parts_item_data in self.parts:
                parts_item = parts_item_data.to_dict()
                parts.append(parts_item)

        content = self.content

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "role": role,
            }
        )
        if parts is not UNSET:
            field_dict["parts"] = parts
        if content is not UNSET:
            field_dict["content"] = content

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.start_langy_conversation_turn_body_messages_item_parts_item import (
            StartLangyConversationTurnBodyMessagesItemPartsItem,
        )

        d = dict(src_dict)
        role = StartLangyConversationTurnBodyMessagesItemRole(d.pop("role"))

        _parts = d.pop("parts", UNSET)
        parts: list[StartLangyConversationTurnBodyMessagesItemPartsItem] | Unset = UNSET
        if _parts is not UNSET:
            parts = []
            for parts_item_data in _parts:
                parts_item = StartLangyConversationTurnBodyMessagesItemPartsItem.from_dict(parts_item_data)

                parts.append(parts_item)

        content = d.pop("content", UNSET)

        start_langy_conversation_turn_body_messages_item = cls(
            role=role,
            parts=parts,
            content=content,
        )

        start_langy_conversation_turn_body_messages_item.additional_properties = d
        return start_langy_conversation_turn_body_messages_item

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
