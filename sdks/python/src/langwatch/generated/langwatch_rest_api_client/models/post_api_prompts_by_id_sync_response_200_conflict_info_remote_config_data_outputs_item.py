from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_outputs_item_type import (
    PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_outputs_item_json_schema import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemJsonSchema,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItem")


@_attrs_define
class PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItem:
    """
    Attributes:
        identifier (str):
        type_ (PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemType):
        json_schema (PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemJsonSchema | Unset):
    """

    identifier: str
    type_: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemType
    json_schema: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemJsonSchema | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        json_schema: dict[str, Any] | Unset = UNSET
        if not isinstance(self.json_schema, Unset):
            json_schema = self.json_schema.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )
        if json_schema is not UNSET:
            field_dict["json_schema"] = json_schema

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_outputs_item_json_schema import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemJsonSchema,
        )

        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemType(d.pop("type"))

        _json_schema = d.pop("json_schema", UNSET)
        json_schema: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemJsonSchema | Unset
        if isinstance(_json_schema, Unset):
            json_schema = UNSET
        else:
            json_schema = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataOutputsItemJsonSchema.from_dict(
                _json_schema
            )

        post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_outputs_item = cls(
            identifier=identifier,
            type_=type_,
            json_schema=json_schema,
        )

        return post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_outputs_item
