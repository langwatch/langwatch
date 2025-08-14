from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_prompts_by_id_sync_body_config_data_prompting_technique_type import (
    PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_body_config_data_prompting_technique_demonstrations import (
        PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueDemonstrations,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique")


@_attrs_define
class PostApiPromptsByIdSyncBodyConfigDataPromptingTechnique:
    """
    Attributes:
        type_ (PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueType):
        demonstrations (Union[Unset, PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueDemonstrations]):
    """

    type_: PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueType
    demonstrations: Union[Unset, "PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueDemonstrations"] = UNSET
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
        from ..models.post_api_prompts_by_id_sync_body_config_data_prompting_technique_demonstrations import (
            PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueDemonstrations,
        )

        d = dict(src_dict)
        type_ = PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueType(d.pop("type"))

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: Union[Unset, PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueDemonstrations]
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = PostApiPromptsByIdSyncBodyConfigDataPromptingTechniqueDemonstrations.from_dict(
                _demonstrations
            )

        post_api_prompts_by_id_sync_body_config_data_prompting_technique = cls(
            type_=type_,
            demonstrations=demonstrations,
        )

        post_api_prompts_by_id_sync_body_config_data_prompting_technique.additional_properties = d
        return post_api_prompts_by_id_sync_body_config_data_prompting_technique

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
