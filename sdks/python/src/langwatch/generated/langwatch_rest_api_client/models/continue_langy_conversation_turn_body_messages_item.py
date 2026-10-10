from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.continue_langy_conversation_turn_body_messages_item_role import (
    ContinueLangyConversationTurnBodyMessagesItemRole,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.continue_langy_conversation_turn_body_messages_item_parts_item import (
        ContinueLangyConversationTurnBodyMessagesItemPartsItem,
    )


T = TypeVar("T", bound="ContinueLangyConversationTurnBodyMessagesItem")


@_attrs_define
class ContinueLangyConversationTurnBodyMessagesItem:
    """
    Attributes:
        role (ContinueLangyConversationTurnBodyMessagesItemRole):
        parts (list[ContinueLangyConversationTurnBodyMessagesItemPartsItem] | Unset):
        content (str | Unset):
    """

    role: ContinueLangyConversationTurnBodyMessagesItemRole
    parts: list[ContinueLangyConversationTurnBodyMessagesItemPartsItem] | Unset = UNSET
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
        from ..models.continue_langy_conversation_turn_body_messages_item_parts_item import (
            ContinueLangyConversationTurnBodyMessagesItemPartsItem,
        )

        d = dict(src_dict)
        role = ContinueLangyConversationTurnBodyMessagesItemRole(d.pop("role"))

        _parts = d.pop("parts", UNSET)
        parts: list[ContinueLangyConversationTurnBodyMessagesItemPartsItem] | Unset = UNSET
        if _parts is not UNSET:
            parts = []
            for parts_item_data in _parts:
                parts_item = ContinueLangyConversationTurnBodyMessagesItemPartsItem.from_dict(parts_item_data)

                parts.append(parts_item)

        content = d.pop("content", UNSET)

        continue_langy_conversation_turn_body_messages_item = cls(
            role=role,
            parts=parts,
            content=content,
        )

        continue_langy_conversation_turn_body_messages_item.additional_properties = d
        return continue_langy_conversation_turn_body_messages_item

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
