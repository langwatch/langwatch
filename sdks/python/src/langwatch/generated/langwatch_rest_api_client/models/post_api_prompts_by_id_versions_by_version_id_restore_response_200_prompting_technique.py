from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_prompts_by_id_versions_by_version_id_restore_response_200_prompting_technique_type import (
    PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_versions_by_version_id_restore_response_200_prompting_technique_demonstrations import (
        PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueDemonstrations,
    )


T = TypeVar("T", bound="PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechnique")


@_attrs_define
class PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechnique:
    """
    Attributes:
        type_ (PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueType):
        demonstrations (PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueDemonstrations |
            Unset):
    """

    type_: PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueType
    demonstrations: PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueDemonstrations | Unset = (
        UNSET
    )
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        demonstrations: dict[str, Any] | Unset = UNSET
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
        from ..models.post_api_prompts_by_id_versions_by_version_id_restore_response_200_prompting_technique_demonstrations import (
            PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueDemonstrations,
        )

        d = dict(src_dict)
        type_ = PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueType(d.pop("type"))

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueDemonstrations | Unset
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = (
                PostApiPromptsByIdVersionsByVersionIdRestoreResponse200PromptingTechniqueDemonstrations.from_dict(
                    _demonstrations
                )
            )

        post_api_prompts_by_id_versions_by_version_id_restore_response_200_prompting_technique = cls(
            type_=type_,
            demonstrations=demonstrations,
        )

        post_api_prompts_by_id_versions_by_version_id_restore_response_200_prompting_technique.additional_properties = d
        return post_api_prompts_by_id_versions_by_version_id_restore_response_200_prompting_technique

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
