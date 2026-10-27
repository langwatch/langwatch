from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_prompting_technique_demonstrations_inline_column_types_item import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineColumnTypesItem,
    )
    from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_prompting_technique_demonstrations_inline_records import (
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineRecords,
    )


T = TypeVar(
    "T", bound="PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInline"
)


@_attrs_define
class PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInline:
    """
    Attributes:
        records
            (PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineRecords):
        column_types (list[PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrations
            InlineColumnTypesItem]):
    """

    records: PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineRecords
    column_types: list[
        PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineColumnTypesItem
    ]

    def to_dict(self) -> dict[str, Any]:
        records = self.records.to_dict()

        column_types = []
        for column_types_item_data in self.column_types:
            column_types_item = column_types_item_data.to_dict()
            column_types.append(column_types_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "records": records,
                "columnTypes": column_types,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_prompting_technique_demonstrations_inline_column_types_item import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineColumnTypesItem,
        )
        from ..models.post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_prompting_technique_demonstrations_inline_records import (
            PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineRecords,
        )

        d = dict(src_dict)
        records = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineRecords.from_dict(
            d.pop("records")
        )

        column_types = []
        _column_types = d.pop("columnTypes")
        for column_types_item_data in _column_types:
            column_types_item = PostApiPromptsByIdSyncResponse200ConflictInfoRemoteConfigDataPromptingTechniqueDemonstrationsInlineColumnTypesItem.from_dict(
                column_types_item_data
            )

            column_types.append(column_types_item)

        post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_prompting_technique_demonstrations_inline = cls(
            records=records,
            column_types=column_types,
        )

        return post_api_prompts_by_id_sync_response_200_conflict_info_remote_config_data_prompting_technique_demonstrations_inline
