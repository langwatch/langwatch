from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_prompts_by_id_versions_response_200_config_data_inputs_item_type import (
    GetApiPromptsByIdVersionsResponse200ConfigDataInputsItemType,
)

T = TypeVar("T", bound="GetApiPromptsByIdVersionsResponse200ConfigDataInputsItem")


@_attrs_define
class GetApiPromptsByIdVersionsResponse200ConfigDataInputsItem:
    """
    Attributes:
        identifier (str):
        type_ (GetApiPromptsByIdVersionsResponse200ConfigDataInputsItemType):
    """

    identifier: str
    type_: GetApiPromptsByIdVersionsResponse200ConfigDataInputsItemType
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = GetApiPromptsByIdVersionsResponse200ConfigDataInputsItemType(d.pop("type"))

        get_api_prompts_by_id_versions_response_200_config_data_inputs_item = cls(
            identifier=identifier,
            type_=type_,
        )

        get_api_prompts_by_id_versions_response_200_config_data_inputs_item.additional_properties = d
        return get_api_prompts_by_id_versions_response_200_config_data_inputs_item

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
