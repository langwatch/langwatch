from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_index_response_200_scope import PostIndexResponse200Scope

if TYPE_CHECKING:
    from ..models.post_index_response_200_messages_item import PostIndexResponse200MessagesItem
    from ..models.post_index_response_200_response_format_type_0 import PostIndexResponse200ResponseFormatType0


T = TypeVar("T", bound="PostIndexResponse200")


@_attrs_define
class PostIndexResponse200:
    """
    Attributes:
        id (str):
        handle (Union[None, str]):
        scope (PostIndexResponse200Scope):
        name (str):
        updated_at (str):
        project_id (str):
        organization_id (str):
        version (float):
        version_id (str):
        version_created_at (str):
        model (str):
        prompt (str):
        messages (list['PostIndexResponse200MessagesItem']):
        response_format (Union['PostIndexResponse200ResponseFormatType0', None]):
    """

    id: str
    handle: Union[None, str]
    scope: PostIndexResponse200Scope
    name: str
    updated_at: str
    project_id: str
    organization_id: str
    version: float
    version_id: str
    version_created_at: str
    model: str
    prompt: str
    messages: list["PostIndexResponse200MessagesItem"]
    response_format: Union["PostIndexResponse200ResponseFormatType0", None]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_index_response_200_response_format_type_0 import PostIndexResponse200ResponseFormatType0

        id = self.id

        handle: Union[None, str]
        handle = self.handle

        scope = self.scope.value

        name = self.name

        updated_at = self.updated_at

        project_id = self.project_id

        organization_id = self.organization_id

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
        if isinstance(self.response_format, PostIndexResponse200ResponseFormatType0):
            response_format = self.response_format.to_dict()
        else:
            response_format = self.response_format

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "handle": handle,
                "scope": scope,
                "name": name,
                "updatedAt": updated_at,
                "projectId": project_id,
                "organizationId": organization_id,
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
        from ..models.post_index_response_200_messages_item import PostIndexResponse200MessagesItem
        from ..models.post_index_response_200_response_format_type_0 import PostIndexResponse200ResponseFormatType0

        d = dict(src_dict)
        id = d.pop("id")

        def _parse_handle(data: object) -> Union[None, str]:
            if data is None:
                return data
            return cast(Union[None, str], data)

        handle = _parse_handle(d.pop("handle"))

        scope = PostIndexResponse200Scope(d.pop("scope"))

        name = d.pop("name")

        updated_at = d.pop("updatedAt")

        project_id = d.pop("projectId")

        organization_id = d.pop("organizationId")

        version = d.pop("version")

        version_id = d.pop("versionId")

        version_created_at = d.pop("versionCreatedAt")

        model = d.pop("model")

        prompt = d.pop("prompt")

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = PostIndexResponse200MessagesItem.from_dict(messages_item_data)

            messages.append(messages_item)

        def _parse_response_format(data: object) -> Union["PostIndexResponse200ResponseFormatType0", None]:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_format_type_0 = PostIndexResponse200ResponseFormatType0.from_dict(data)

                return response_format_type_0
            except:  # noqa: E722
                pass
            return cast(Union["PostIndexResponse200ResponseFormatType0", None], data)

        response_format = _parse_response_format(d.pop("response_format"))

        post_index_response_200 = cls(
            id=id,
            handle=handle,
            scope=scope,
            name=name,
            updated_at=updated_at,
            project_id=project_id,
            organization_id=organization_id,
            version=version,
            version_id=version_id,
            version_created_at=version_created_at,
            model=model,
            prompt=prompt,
            messages=messages,
            response_format=response_format,
        )

        post_index_response_200.additional_properties = d
        return post_index_response_200

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
