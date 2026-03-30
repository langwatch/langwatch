from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200ConflictInfo")


@_attrs_define
class PostApiPromptsByIdSyncResponse200ConflictInfo:
    """
    Attributes:
        local_version (float):
        remote_version (float):
        differences (list[str]):
        remote_config_data (PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData):
    """

    local_version: float
    remote_version: float
    differences: list[str]
    remote_config_data: "PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        local_version = self.local_version

        remote_version = self.remote_version

        differences = self.differences

        remote_config_data = self.remote_config_data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "localVersion": local_version,
                "remoteVersion": remote_version,
                "differences": differences,
                "remoteConfigData": remote_config_data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData,
        )

        d = dict(src_dict)
        local_version = d.pop("localVersion")

        remote_version = d.pop("remoteVersion")

        differences = cast(list[str], d.pop("differences"))

        remote_config_data = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData.from_dict(
            d.pop("remoteConfigData")
        )

        post_api_prompts_by_id_sync_response_200_conflict_info = cls(
            local_version=local_version,
            remote_version=remote_version,
            differences=differences,
            remote_config_data=remote_config_data,
        )

        post_api_prompts_by_id_sync_response_200_conflict_info.additional_properties = d
        return post_api_prompts_by_id_sync_response_200_conflict_info

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
