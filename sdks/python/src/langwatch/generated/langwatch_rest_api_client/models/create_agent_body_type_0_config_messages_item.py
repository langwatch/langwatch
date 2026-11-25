from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_agent_body_type_0_config_messages_item_role import CreateAgentBodyType0ConfigMessagesItemRole
from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateAgentBodyType0ConfigMessagesItem")


@_attrs_define
class CreateAgentBodyType0ConfigMessagesItem:
    """
    Attributes:
        role (CreateAgentBodyType0ConfigMessagesItemRole | Unset):
        content (str | Unset):
    """

    role: CreateAgentBodyType0ConfigMessagesItemRole | Unset = UNSET
    content: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role: str | Unset = UNSET
        if not isinstance(self.role, Unset):
            role = self.role.value

        content = self.content

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if role is not UNSET:
            field_dict["role"] = role
        if content is not UNSET:
            field_dict["content"] = content

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _role = d.pop("role", UNSET)
        role: CreateAgentBodyType0ConfigMessagesItemRole | Unset
        if isinstance(_role, Unset):
            role = UNSET
        else:
            role = CreateAgentBodyType0ConfigMessagesItemRole(_role)

        content = d.pop("content", UNSET)

        create_agent_body_type_0_config_messages_item = cls(
            role=role,
            content=content,
        )

        create_agent_body_type_0_config_messages_item.additional_properties = d
        return create_agent_body_type_0_config_messages_item

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
