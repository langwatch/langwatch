from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
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
        commit_message (Union[None, Unset, str]):
    """

    id: str
    author_id: Union[None, str]
    project_id: str
    config_id: str
    schema_version: Literal["1.0"]
    version: float
    created_at: str
    config_data: "GetApiPromptsByIdVersionsResponse200ConfigData"
    commit_message: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        author_id: Union[None, str]
        author_id = self.author_id

        project_id = self.project_id

        config_id = self.config_id

        schema_version = self.schema_version

        version = self.version

        created_at = self.created_at

        config_data = self.config_data.to_dict()

        commit_message: Union[None, Unset, str]
        if isinstance(self.commit_message, Unset):
            commit_message = UNSET
        else:
            commit_message = self.commit_message

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
            }
        )
        if commit_message is not UNSET:
            field_dict["commitMessage"] = commit_message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
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

        def _parse_commit_message(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        commit_message = _parse_commit_message(d.pop("commitMessage", UNSET))

        get_api_prompts_by_id_versions_response_200 = cls(
            id=id,
            author_id=author_id,
            project_id=project_id,
            config_id=config_id,
            schema_version=schema_version,
            version=version,
            created_at=created_at,
            config_data=config_data,
            commit_message=commit_message,
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
