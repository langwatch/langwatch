from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_type import (
    PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations import (
        PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200PromptPromptingTechnique")


@_attrs_define
class PostApiPromptsByIdSyncResponse200PromptPromptingTechnique:
    """
    Attributes:
        type_ (PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueType):
        demonstrations (PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations | Unset):
    """

    type_: PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueType
    demonstrations: PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        demonstrations: dict[str, Any] | Unset = UNSET
        if not isinstance(self.demonstrations, Unset):
            demonstrations = self.demonstrations.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
            }
        )
        if demonstrations is not UNSET:
            field_dict["demonstrations"] = demonstrations

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations import (
            PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations,
        )

        d = dict(src_dict)
        type_ = PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueType(d.pop("type"))

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations | Unset
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations.from_dict(
                _demonstrations
            )

        post_api_prompts_by_id_sync_response_200_prompt_prompting_technique = cls(
            type_=type_,
            demonstrations=demonstrations,
        )

        return post_api_prompts_by_id_sync_response_200_prompt_prompting_technique
