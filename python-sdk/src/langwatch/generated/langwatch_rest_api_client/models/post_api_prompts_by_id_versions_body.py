from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_versions_body_config_data import PostApiPromptsByIdVersionsBodyConfigData


T = TypeVar("T", bound="PostApiPromptsByIdVersionsBody")


@_attrs_define
class PostApiPromptsByIdVersionsBody:
    """
    Attributes:
        project_id (str):
        config_id (str):
        schema_version (Literal['1.0']):
        commit_message (str):
        version (float):
        config_data (PostApiPromptsByIdVersionsBodyConfigData):
        id (Union[Unset, str]):
        author_id (Union[None, Unset, str]):
        created_at (Union[Unset, str]):
    """

    project_id: str
    config_id: str
    schema_version: Literal["1.0"]
    commit_message: str
    version: float
    config_data: "PostApiPromptsByIdVersionsBodyConfigData"
    id: Union[Unset, str] = UNSET
    author_id: Union[None, Unset, str] = UNSET
    created_at: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        project_id = self.project_id

        config_id = self.config_id

        schema_version = self.schema_version

        commit_message = self.commit_message

        version = self.version

        config_data = self.config_data.to_dict()

        id = self.id

        author_id: Union[None, Unset, str]
        if isinstance(self.author_id, Unset):
            author_id = UNSET
        else:
            author_id = self.author_id

        created_at = self.created_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "projectId": project_id,
                "configId": config_id,
                "schemaVersion": schema_version,
                "commitMessage": commit_message,
                "version": version,
                "configData": config_data,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if author_id is not UNSET:
            field_dict["authorId"] = author_id
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_versions_body_config_data import PostApiPromptsByIdVersionsBodyConfigData

        d = dict(src_dict)
        project_id = d.pop("projectId")

        config_id = d.pop("configId")

        schema_version = cast(Literal["1.0"], d.pop("schemaVersion"))
        if schema_version != "1.0":
            raise ValueError(f"schemaVersion must match const '1.0', got '{schema_version}'")

        commit_message = d.pop("commitMessage")

        version = d.pop("version")

        config_data = PostApiPromptsByIdVersionsBodyConfigData.from_dict(d.pop("configData"))

        id = d.pop("id", UNSET)

        def _parse_author_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        author_id = _parse_author_id(d.pop("authorId", UNSET))

        created_at = d.pop("createdAt", UNSET)

        post_api_prompts_by_id_versions_body = cls(
            project_id=project_id,
            config_id=config_id,
            schema_version=schema_version,
            commit_message=commit_message,
            version=version,
            config_data=config_data,
            id=id,
            author_id=author_id,
            created_at=created_at,
        )

        post_api_prompts_by_id_versions_body.additional_properties = d
        return post_api_prompts_by_id_versions_body

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
