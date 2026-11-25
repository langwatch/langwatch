from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_prompts_response_200_prompting_technique_type import (
    PostApiPromptsResponse200PromptingTechniqueType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_response_200_prompting_technique_demonstrations import (
        PostApiPromptsResponse200PromptingTechniqueDemonstrations,
    )


T = TypeVar("T", bound="PostApiPromptsResponse200PromptingTechnique")


@_attrs_define
class PostApiPromptsResponse200PromptingTechnique:
    """
    Attributes:
        type_ (PostApiPromptsResponse200PromptingTechniqueType):
        demonstrations (PostApiPromptsResponse200PromptingTechniqueDemonstrations | Unset):
    """

    type_: PostApiPromptsResponse200PromptingTechniqueType
    demonstrations: PostApiPromptsResponse200PromptingTechniqueDemonstrations | Unset = UNSET

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
        from ..models.post_api_prompts_response_200_prompting_technique_demonstrations import (
            PostApiPromptsResponse200PromptingTechniqueDemonstrations,
        )

        d = dict(src_dict)
        type_ = PostApiPromptsResponse200PromptingTechniqueType(d.pop("type"))

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: PostApiPromptsResponse200PromptingTechniqueDemonstrations | Unset
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = PostApiPromptsResponse200PromptingTechniqueDemonstrations.from_dict(_demonstrations)

        post_api_prompts_response_200_prompting_technique = cls(
            type_=type_,
            demonstrations=demonstrations,
        )

        return post_api_prompts_response_200_prompting_technique
