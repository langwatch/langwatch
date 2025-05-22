from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiPromptsByIdVersionsResponse200ConfigDataOutputsItemJsonSchema")


@_attrs_define
class PostApiPromptsByIdVersionsResponse200ConfigDataOutputsItemJsonSchema:
    """
    Attributes:
        type_ (str):
    """

    type_: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        post_api_prompts_by_id_versions_response_200_config_data_outputs_item_json_schema = cls(
            type_=type_,
        )

        post_api_prompts_by_id_versions_response_200_config_data_outputs_item_json_schema.additional_properties = d
        return post_api_prompts_by_id_versions_response_200_config_data_outputs_item_json_schema

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
