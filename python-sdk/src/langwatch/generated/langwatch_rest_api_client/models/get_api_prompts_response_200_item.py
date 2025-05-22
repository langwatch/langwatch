from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_prompts_response_200_item_messages_item import GetApiPromptsResponse200ItemMessagesItem
    from ..models.get_api_prompts_response_200_item_response_format_type_0 import (
        GetApiPromptsResponse200ItemResponseFormatType0,
    )


T = TypeVar("T", bound="GetApiPromptsResponse200Item")


@_attrs_define
class GetApiPromptsResponse200Item:
    """
    Attributes:
        id (str):
        name (str):
        updated_at (str):
        version (float):
        version_id (str):
        version_created_at (str):
        model (str):
        prompt (str):
        messages (list['GetApiPromptsResponse200ItemMessagesItem']):
        response_format (Union['GetApiPromptsResponse200ItemResponseFormatType0', None]):
    """

    id: str
    name: str
    updated_at: str
    version: float
    version_id: str
    version_created_at: str
    model: str
    prompt: str
    messages: list["GetApiPromptsResponse200ItemMessagesItem"]
    response_format: Union["GetApiPromptsResponse200ItemResponseFormatType0", None]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_prompts_response_200_item_response_format_type_0 import (
            GetApiPromptsResponse200ItemResponseFormatType0,
        )

        id = self.id

        name = self.name

        updated_at = self.updated_at

        version = self.version

        version_id = self.version_id

        version_created_at = self.version_created_at

        model = self.model

        prompt = self.prompt

        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        response_format: Union[None, dict[str, Any]]
        if isinstance(self.response_format, GetApiPromptsResponse200ItemResponseFormatType0):
            response_format = self.response_format.to_dict()
        else:
            response_format = self.response_format

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "updatedAt": updated_at,
                "version": version,
                "versionId": version_id,
                "versionCreatedAt": version_created_at,
                "model": model,
                "prompt": prompt,
                "messages": messages,
                "response_format": response_format,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_prompts_response_200_item_messages_item import GetApiPromptsResponse200ItemMessagesItem
        from ..models.get_api_prompts_response_200_item_response_format_type_0 import (
            GetApiPromptsResponse200ItemResponseFormatType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        updated_at = d.pop("updatedAt")

        version = d.pop("version")

        version_id = d.pop("versionId")

        version_created_at = d.pop("versionCreatedAt")

        model = d.pop("model")

        prompt = d.pop("prompt")

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = GetApiPromptsResponse200ItemMessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        def _parse_response_format(data: object) -> Union["GetApiPromptsResponse200ItemResponseFormatType0", None]:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_format_type_0 = GetApiPromptsResponse200ItemResponseFormatType0.from_dict(data)

                return response_format_type_0
            except:  # noqa: E722
                pass
            return cast(Union["GetApiPromptsResponse200ItemResponseFormatType0", None], data)

        response_format = _parse_response_format(d.pop("response_format"))

        get_api_prompts_response_200_item = cls(
            id=id,
            name=name,
            updated_at=updated_at,
            version=version,
            version_id=version_id,
            version_created_at=version_created_at,
            model=model,
            prompt=prompt,
            messages=messages,
            response_format=response_format,
        )

        get_api_prompts_response_200_item.additional_properties = d
        return get_api_prompts_response_200_item

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
