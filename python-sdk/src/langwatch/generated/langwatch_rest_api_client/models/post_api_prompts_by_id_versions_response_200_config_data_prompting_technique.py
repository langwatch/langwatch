from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiPromptsByIdVersionsResponse200ConfigDataPromptingTechnique")


@_attrs_define
class PostApiPromptsByIdVersionsResponse200ConfigDataPromptingTechnique:
    """
    Attributes:
        ref (Union[Unset, str]):
    """

    ref: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ref = self.ref

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if ref is not UNSET:
            field_dict["ref"] = ref

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ref = d.pop("ref", UNSET)

        post_api_prompts_by_id_versions_response_200_config_data_prompting_technique = cls(
            ref=ref,
        )

        post_api_prompts_by_id_versions_response_200_config_data_prompting_technique.additional_properties = d
        return post_api_prompts_by_id_versions_response_200_config_data_prompting_technique

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
