from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations_inline import (
        PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInline,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations")


@_attrs_define
class PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrations:
    """
    Attributes:
        id (Union[Unset, str]):
        name (Union[Unset, str]):
        inline (Union[Unset, PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInline]):
    """

    id: Union[Unset, str] = UNSET
    name: Union[Unset, str] = UNSET
    inline: Union[Unset, "PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInline"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        inline: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.inline, Unset):
            inline = self.inline.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if name is not UNSET:
            field_dict["name"] = name
        if inline is not UNSET:
            field_dict["inline"] = inline

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations_inline import (
            PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInline,
        )

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        _inline = d.pop("inline", UNSET)
        inline: Union[Unset, PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInline]
        if isinstance(_inline, Unset):
            inline = UNSET
        else:
            inline = PostApiPromptsByIdSyncResponse200PromptPromptingTechniqueDemonstrationsInline.from_dict(_inline)

        post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations = cls(
            id=id,
            name=name,
            inline=inline,
        )

        post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations.additional_properties = d
        return post_api_prompts_by_id_sync_response_200_prompt_prompting_technique_demonstrations

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
