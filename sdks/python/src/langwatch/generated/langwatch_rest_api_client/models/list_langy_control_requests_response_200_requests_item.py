from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="ListLangyControlRequestsResponse200RequestsItem")


@_attrs_define
class ListLangyControlRequestsResponse200RequestsItem:
    """
    Attributes:
        id (str):
        conversation_id (str):
        conversation_title (str):
        conversation_url (str):
        project_id (str):
        project_name (str):
        created_at (str):
        expires_at (str):
    """

    id: str
    conversation_id: str
    conversation_title: str
    conversation_url: str
    project_id: str
    project_name: str
    created_at: str
    expires_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        conversation_id = self.conversation_id

        conversation_title = self.conversation_title

        conversation_url = self.conversation_url

        project_id = self.project_id

        project_name = self.project_name

        created_at = self.created_at

        expires_at = self.expires_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "conversationId": conversation_id,
                "conversationTitle": conversation_title,
                "conversationUrl": conversation_url,
                "projectId": project_id,
                "projectName": project_name,
                "createdAt": created_at,
                "expiresAt": expires_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        conversation_id = d.pop("conversationId")

        conversation_title = d.pop("conversationTitle")

        conversation_url = d.pop("conversationUrl")

        project_id = d.pop("projectId")

        project_name = d.pop("projectName")

        created_at = d.pop("createdAt")

        expires_at = d.pop("expiresAt")

        list_langy_control_requests_response_200_requests_item = cls(
            id=id,
            conversation_id=conversation_id,
            conversation_title=conversation_title,
            conversation_url=conversation_url,
            project_id=project_id,
            project_name=project_name,
            created_at=created_at,
            expires_at=expires_at,
        )

        list_langy_control_requests_response_200_requests_item.additional_properties = d
        return list_langy_control_requests_response_200_requests_item

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
