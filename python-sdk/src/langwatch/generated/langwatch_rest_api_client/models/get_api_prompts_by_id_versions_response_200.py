from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_prompts_by_id_versions_response_200_scope import GetApiPromptsByIdVersionsResponse200Scope
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_prompts_by_id_versions_response_200_author_type_0 import (
        GetApiPromptsByIdVersionsResponse200AuthorType0,
    )
    from ..models.get_api_prompts_by_id_versions_response_200_config_data import (
        GetApiPromptsByIdVersionsResponse200ConfigData,
    )


T = TypeVar("T", bound="GetApiPromptsByIdVersionsResponse200")


@_attrs_define
class GetApiPromptsByIdVersionsResponse200:
    """
    Attributes:
        id (str):
        author_id (Union[None, str]):
        project_id (str):
        config_id (str):
        schema_version (Literal['1.0']):
        version (float):
        created_at (str):
        config_data (GetApiPromptsByIdVersionsResponse200ConfigData):
        handle (Union[None, str]):
        scope (GetApiPromptsByIdVersionsResponse200Scope):
        commit_message (Union[None, Unset, str]):
        author (Union['GetApiPromptsByIdVersionsResponse200AuthorType0', None, Unset]):
    """

    id: str
    author_id: Union[None, str]
    project_id: str
    config_id: str
    schema_version: Literal["1.0"]
    version: float
    created_at: str
    config_data: "GetApiPromptsByIdVersionsResponse200ConfigData"
    handle: Union[None, str]
    scope: GetApiPromptsByIdVersionsResponse200Scope
    commit_message: Union[None, Unset, str] = UNSET
    author: Union["GetApiPromptsByIdVersionsResponse200AuthorType0", None, Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_prompts_by_id_versions_response_200_author_type_0 import (
            GetApiPromptsByIdVersionsResponse200AuthorType0,
        )

        id = self.id

        author_id: Union[None, str]
        author_id = self.author_id

        project_id = self.project_id

        config_id = self.config_id

        schema_version = self.schema_version

        version = self.version

        created_at = self.created_at

        config_data = self.config_data.to_dict()

        handle: Union[None, str]
        handle = self.handle

        scope = self.scope.value

        commit_message: Union[None, Unset, str]
        if isinstance(self.commit_message, Unset):
            commit_message = UNSET
        else:
            commit_message = self.commit_message

        author: Union[None, Unset, dict[str, Any]]
        if isinstance(self.author, Unset):
            author = UNSET
        elif isinstance(self.author, GetApiPromptsByIdVersionsResponse200AuthorType0):
            author = self.author.to_dict()
        else:
            author = self.author

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "authorId": author_id,
                "projectId": project_id,
                "configId": config_id,
                "schemaVersion": schema_version,
                "version": version,
                "createdAt": created_at,
                "configData": config_data,
                "handle": handle,
                "scope": scope,
            }
        )
        if commit_message is not UNSET:
            field_dict["commitMessage"] = commit_message
        if author is not UNSET:
            field_dict["author"] = author

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_prompts_by_id_versions_response_200_author_type_0 import (
            GetApiPromptsByIdVersionsResponse200AuthorType0,
        )
        from ..models.get_api_prompts_by_id_versions_response_200_config_data import (
            GetApiPromptsByIdVersionsResponse200ConfigData,
        )

        d = dict(src_dict)
        id = d.pop("id")

        def _parse_author_id(data: object) -> Union[None, str]:
            if data is None:
                return data
            return cast(Union[None, str], data)

        author_id = _parse_author_id(d.pop("authorId"))

        project_id = d.pop("projectId")

        config_id = d.pop("configId")

        schema_version = cast(Literal["1.0"], d.pop("schemaVersion"))
        if schema_version != "1.0":
            raise ValueError(f"schemaVersion must match const '1.0', got '{schema_version}'")

        version = d.pop("version")

        created_at = d.pop("createdAt")

        config_data = GetApiPromptsByIdVersionsResponse200ConfigData.from_dict(d.pop("configData"))

        def _parse_handle(data: object) -> Union[None, str]:
            if data is None:
                return data
            return cast(Union[None, str], data)

        handle = _parse_handle(d.pop("handle"))

        scope = GetApiPromptsByIdVersionsResponse200Scope(d.pop("scope"))

        def _parse_commit_message(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        commit_message = _parse_commit_message(d.pop("commitMessage", UNSET))

        def _parse_author(data: object) -> Union["GetApiPromptsByIdVersionsResponse200AuthorType0", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                author_type_0 = GetApiPromptsByIdVersionsResponse200AuthorType0.from_dict(data)

                return author_type_0
            except:  # noqa: E722
                pass
            return cast(Union["GetApiPromptsByIdVersionsResponse200AuthorType0", None, Unset], data)

        author = _parse_author(d.pop("author", UNSET))

        get_api_prompts_by_id_versions_response_200 = cls(
            id=id,
            author_id=author_id,
            project_id=project_id,
            config_id=config_id,
            schema_version=schema_version,
            version=version,
            created_at=created_at,
            config_data=config_data,
            handle=handle,
            scope=scope,
            commit_message=commit_message,
            author=author,
        )

        get_api_prompts_by_id_versions_response_200.additional_properties = d
        return get_api_prompts_by_id_versions_response_200

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
