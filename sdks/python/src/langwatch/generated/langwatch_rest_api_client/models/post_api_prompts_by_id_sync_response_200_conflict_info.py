from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_parameters import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteParameters,
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
        remote_parameters (PostApiPromptsByIdSyncResponse200ConflictInfoRemoteParameters | Unset):
    """

    local_version: float
    remote_version: float
    differences: list[str]
    remote_config_data: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData
    remote_parameters: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteParameters | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        local_version = self.local_version

        remote_version = self.remote_version

        differences = self.differences

        remote_config_data = self.remote_config_data.to_dict()

        remote_parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.remote_parameters, Unset):
            remote_parameters = self.remote_parameters.to_dict()

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
        if remote_parameters is not UNSET:
            field_dict["remoteParameters"] = remote_parameters

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_parameters import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteParameters,
        )

        d = dict(src_dict)
        local_version = d.pop("localVersion")

        remote_version = d.pop("remoteVersion")

        differences = cast(list[str], d.pop("differences"))

        remote_config_data = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigData.from_dict(
            d.pop("remoteConfigData")
        )

        _remote_parameters = d.pop("remoteParameters", UNSET)
        remote_parameters: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteParameters | Unset
        if isinstance(_remote_parameters, Unset):
            remote_parameters = UNSET
        else:
            remote_parameters = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteParameters.from_dict(
                _remote_parameters
            )

        post_api_prompts_by_id_sync_response_200_conflict_info = cls(
            local_version=local_version,
            remote_version=remote_version,
            differences=differences,
            remote_config_data=remote_config_data,
            remote_parameters=remote_parameters,
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
