from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_prompts_by_id_versions_response_200_config_data_messages_item_role import (
    GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole,
)

T = TypeVar("T", bound="GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItem")


@_attrs_define
class GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItem:
    """
    Attributes:
        role (GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole):
        content (str):
    """

    role: GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole
    content: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        role = self.role.value

        content = self.content

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "role": role,
                "content": content,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole(d.pop("role"))

        content = d.pop("content")

        get_api_prompts_by_id_versions_response_200_config_data_messages_item = cls(
            role=role,
            content=content,
        )

        get_api_prompts_by_id_versions_response_200_config_data_messages_item.additional_properties = d
        return get_api_prompts_by_id_versions_response_200_config_data_messages_item

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
