from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        demonstrations (Union[Unset, PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations]):
    """

    type_: PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueType
    demonstrations: Union[Unset, "PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        demonstrations: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.demonstrations, Unset):
            demonstrations = self.demonstrations.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        demonstrations: Union[Unset, PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations]
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

        post_api_prompts_by_id_sync_response_200_prompt_prompting_technique.additional_properties = d
        return post_api_prompts_by_id_sync_response_200_prompt_prompting_technique

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
