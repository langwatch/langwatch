from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_prompts_by_id_response_200_outputs_item_type import GetApiPromptsByIdResponse200OutputsItemType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_prompts_by_id_response_200_outputs_item_json_schema import (
        GetApiPromptsByIdResponse200OutputsItemJsonSchema,
    )


T = TypeVar("T", bound="GetApiPromptsByIdResponse200OutputsItem")


@_attrs_define
class GetApiPromptsByIdResponse200OutputsItem:
    """
    Attributes:
        identifier (str):
        type_ (GetApiPromptsByIdResponse200OutputsItemType):
        json_schema (Union[Unset, GetApiPromptsByIdResponse200OutputsItemJsonSchema]):
    """

    identifier: str
    type_: GetApiPromptsByIdResponse200OutputsItemType
    json_schema: Union[Unset, "GetApiPromptsByIdResponse200OutputsItemJsonSchema"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        identifier = self.identifier

        type_ = self.type_.value

        json_schema: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.json_schema, Unset):
            json_schema = self.json_schema.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "identifier": identifier,
                "type": type_,
            }
        )
        if json_schema is not UNSET:
            field_dict["json_schema"] = json_schema

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_prompts_by_id_response_200_outputs_item_json_schema import (
            GetApiPromptsByIdResponse200OutputsItemJsonSchema,
        )

        d = dict(src_dict)
        identifier = d.pop("identifier")

        type_ = GetApiPromptsByIdResponse200OutputsItemType(d.pop("type"))

        _json_schema = d.pop("json_schema", UNSET)
        json_schema: Union[Unset, GetApiPromptsByIdResponse200OutputsItemJsonSchema]
        if isinstance(_json_schema, Unset):
            json_schema = UNSET
        else:
            json_schema = GetApiPromptsByIdResponse200OutputsItemJsonSchema.from_dict(_json_schema)

        get_api_prompts_by_id_response_200_outputs_item = cls(
            identifier=identifier,
            type_=type_,
            json_schema=json_schema,
        )

        get_api_prompts_by_id_response_200_outputs_item.additional_properties = d
        return get_api_prompts_by_id_response_200_outputs_item

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
