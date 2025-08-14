from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_prompts_by_id_response_200_prompting_technique_type import (
    GetApiPromptsByIdResponse200PromptingTechniqueType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_prompts_by_id_response_200_prompting_technique_demonstrations import (
        GetApiPromptsByIdResponse200PromptingTechniqueDemonstrations,
    )


T = TypeVar("T", bound="GetApiPromptsByIdResponse200PromptingTechnique")


@_attrs_define
class GetApiPromptsByIdResponse200PromptingTechnique:
    """
    Attributes:
        type_ (GetApiPromptsByIdResponse200PromptingTechniqueType):
        demonstrations (Union[Unset, GetApiPromptsByIdResponse200PromptingTechniqueDemonstrations]):
    """

    type_: GetApiPromptsByIdResponse200PromptingTechniqueType
    demonstrations: Union[Unset, "GetApiPromptsByIdResponse200PromptingTechniqueDemonstrations"] = UNSET
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
        from ..models.get_api_prompts_by_id_response_200_prompting_technique_demonstrations import (
            GetApiPromptsByIdResponse200PromptingTechniqueDemonstrations,
        )

        d = dict(src_dict)
        type_ = GetApiPromptsByIdResponse200PromptingTechniqueType(d.pop("type"))

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: Union[Unset, GetApiPromptsByIdResponse200PromptingTechniqueDemonstrations]
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = GetApiPromptsByIdResponse200PromptingTechniqueDemonstrations.from_dict(_demonstrations)

        get_api_prompts_by_id_response_200_prompting_technique = cls(
            type_=type_,
            demonstrations=demonstrations,
        )

        get_api_prompts_by_id_response_200_prompting_technique.additional_properties = d
        return get_api_prompts_by_id_response_200_prompting_technique

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
