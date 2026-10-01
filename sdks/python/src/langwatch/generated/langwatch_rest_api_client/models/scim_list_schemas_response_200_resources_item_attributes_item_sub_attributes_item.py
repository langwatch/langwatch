from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ScimListSchemasResponse200ResourcesItemAttributesItemSubAttributesItem")


@_attrs_define
class ScimListSchemasResponse200ResourcesItemAttributesItemSubAttributesItem:
    """
    Attributes:
        name (str):
        type_ (str):
        multi_valued (bool):
        required (bool):
        mutability (str):
        returned (str):
        description (str | Unset):
    """

    name: str
    type_: str
    multi_valued: bool
    required: bool
    mutability: str
    returned: str
    description: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        multi_valued = self.multi_valued

        required = self.required

        mutability = self.mutability

        returned = self.returned

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
                "multiValued": multi_valued,
                "required": required,
                "mutability": mutability,
                "returned": returned,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = d.pop("type")

        multi_valued = d.pop("multiValued")

        required = d.pop("required")

        mutability = d.pop("mutability")

        returned = d.pop("returned")

        description = d.pop("description", UNSET)

        scim_list_schemas_response_200_resources_item_attributes_item_sub_attributes_item = cls(
            name=name,
            type_=type_,
            multi_valued=multi_valued,
            required=required,
            mutability=mutability,
            returned=returned,
            description=description,
        )

        return scim_list_schemas_response_200_resources_item_attributes_item_sub_attributes_item
