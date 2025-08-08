from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_body_config_data import PostApiPromptsByIdSyncBodyConfigData


T = TypeVar("T", bound="PostApiPromptsByIdSyncBody")


@_attrs_define
class PostApiPromptsByIdSyncBody:
    """
    Attributes:
        config_data (PostApiPromptsByIdSyncBodyConfigData):
        local_version (Union[Unset, float]):
        commit_message (Union[Unset, str]):
    """

    config_data: "PostApiPromptsByIdSyncBodyConfigData"
    local_version: Union[Unset, float] = UNSET
    commit_message: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        config_data = self.config_data.to_dict()

        local_version = self.local_version

        commit_message = self.commit_message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "configData": config_data,
            }
        )
        if local_version is not UNSET:
            field_dict["localVersion"] = local_version
        if commit_message is not UNSET:
            field_dict["commitMessage"] = commit_message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_body_config_data import PostApiPromptsByIdSyncBodyConfigData

        d = dict(src_dict)
        config_data = PostApiPromptsByIdSyncBodyConfigData.from_dict(d.pop("configData"))

        local_version = d.pop("localVersion", UNSET)

        commit_message = d.pop("commitMessage", UNSET)

        post_api_prompts_by_id_sync_body = cls(
            config_data=config_data,
            local_version=local_version,
            commit_message=commit_message,
        )

        post_api_prompts_by_id_sync_body.additional_properties = d
        return post_api_prompts_by_id_sync_body

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
