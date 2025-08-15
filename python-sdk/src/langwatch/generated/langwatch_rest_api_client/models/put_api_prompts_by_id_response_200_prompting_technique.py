from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.put_api_prompts_by_id_response_200_prompting_technique_type import (
    PutApiPromptsByIdResponse200PromptingTechniqueType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_prompts_by_id_response_200_prompting_technique_demonstrations import (
        PutApiPromptsByIdResponse200PromptingTechniqueDemonstrations,
    )


T = TypeVar("T", bound="PutApiPromptsByIdResponse200PromptingTechnique")


@_attrs_define
class PutApiPromptsByIdResponse200PromptingTechnique:
    """
    Attributes:
        type_ (PutApiPromptsByIdResponse200PromptingTechniqueType):
        demonstrations (Union[Unset, PutApiPromptsByIdResponse200PromptingTechniqueDemonstrations]):
    """

    type_: PutApiPromptsByIdResponse200PromptingTechniqueType
    demonstrations: Union[Unset, "PutApiPromptsByIdResponse200PromptingTechniqueDemonstrations"] = UNSET
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
        from ..models.put_api_prompts_by_id_response_200_prompting_technique_demonstrations import (
            PutApiPromptsByIdResponse200PromptingTechniqueDemonstrations,
        )

        d = dict(src_dict)
        type_ = PutApiPromptsByIdResponse200PromptingTechniqueType(d.pop("type"))

        _demonstrations = d.pop("demonstrations", UNSET)
        demonstrations: Union[Unset, PutApiPromptsByIdResponse200PromptingTechniqueDemonstrations]
        if isinstance(_demonstrations, Unset):
            demonstrations = UNSET
        else:
            demonstrations = PutApiPromptsByIdResponse200PromptingTechniqueDemonstrations.from_dict(_demonstrations)

        put_api_prompts_by_id_response_200_prompting_technique = cls(
            type_=type_,
            demonstrations=demonstrations,
        )

        put_api_prompts_by_id_response_200_prompting_technique.additional_properties = d
        return put_api_prompts_by_id_response_200_prompting_technique

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
