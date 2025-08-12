from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_response_format_type import (
    PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatType,
)

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_response_format_json_schema import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatJsonSchema,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormat")


@_attrs_define
class PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormat:
    """
    Attributes:
        type_ (PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatType):
        json_schema (PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatJsonSchema):
    """

    type_: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatType
    json_schema: "PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatJsonSchema"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        json_schema = self.json_schema.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "json_schema": json_schema,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_response_format_json_schema import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatJsonSchema,
        )

        d = dict(src_dict)
        type_ = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatType(d.pop("type"))

        json_schema = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataResponseFormatJsonSchema.from_dict(
            d.pop("json_schema")
        )

        post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_response_format = cls(
            type_=type_,
            json_schema=json_schema,
        )

        post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_response_format.additional_properties = d
        return post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_response_format

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
