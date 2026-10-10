from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_list_schemas_response_200_resources_item_attributes_item_sub_attributes_item import (
        ScimListSchemasResponse200ResourcesItemAttributesItemSubAttributesItem,
    )


T = TypeVar("T", bound="ScimListSchemasResponse200ResourcesItemAttributesItem")


@_attrs_define
class ScimListSchemasResponse200ResourcesItemAttributesItem:
    """
    Attributes:
        name (str):
        type_ (str):
        multi_valued (bool):
        required (bool):
        mutability (str):
        returned (str):
        case_exact (bool | Unset):
        uniqueness (str | Unset):
        description (str | Unset):
        sub_attributes (list[ScimListSchemasResponse200ResourcesItemAttributesItemSubAttributesItem] | Unset):
    """

    name: str
    type_: str
    multi_valued: bool
    required: bool
    mutability: str
    returned: str
    case_exact: bool | Unset = UNSET
    uniqueness: str | Unset = UNSET
    description: str | Unset = UNSET
    sub_attributes: list[ScimListSchemasResponse200ResourcesItemAttributesItemSubAttributesItem] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        multi_valued = self.multi_valued

        required = self.required

        mutability = self.mutability

        returned = self.returned

        case_exact = self.case_exact

        uniqueness = self.uniqueness

        description = self.description

        sub_attributes: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.sub_attributes, Unset):
            sub_attributes = []
            for sub_attributes_item_data in self.sub_attributes:
                sub_attributes_item = sub_attributes_item_data.to_dict()
                sub_attributes.append(sub_attributes_item)

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
        if case_exact is not UNSET:
            field_dict["caseExact"] = case_exact
        if uniqueness is not UNSET:
            field_dict["uniqueness"] = uniqueness
        if description is not UNSET:
            field_dict["description"] = description
        if sub_attributes is not UNSET:
            field_dict["subAttributes"] = sub_attributes

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_list_schemas_response_200_resources_item_attributes_item_sub_attributes_item import (
            ScimListSchemasResponse200ResourcesItemAttributesItemSubAttributesItem,
        )

        d = dict(src_dict)
        name = d.pop("name")

        type_ = d.pop("type")

        multi_valued = d.pop("multiValued")

        required = d.pop("required")

        mutability = d.pop("mutability")

        returned = d.pop("returned")

        case_exact = d.pop("caseExact", UNSET)

        uniqueness = d.pop("uniqueness", UNSET)

        description = d.pop("description", UNSET)

        _sub_attributes = d.pop("subAttributes", UNSET)
        sub_attributes: list[ScimListSchemasResponse200ResourcesItemAttributesItemSubAttributesItem] | Unset = UNSET
        if _sub_attributes is not UNSET:
            sub_attributes = []
            for sub_attributes_item_data in _sub_attributes:
                sub_attributes_item = ScimListSchemasResponse200ResourcesItemAttributesItemSubAttributesItem.from_dict(
                    sub_attributes_item_data
                )

                sub_attributes.append(sub_attributes_item)

        scim_list_schemas_response_200_resources_item_attributes_item = cls(
            name=name,
            type_=type_,
            multi_valued=multi_valued,
            required=required,
            mutability=mutability,
            returned=returned,
            case_exact=case_exact,
            uniqueness=uniqueness,
            description=description,
            sub_attributes=sub_attributes,
        )

        return scim_list_schemas_response_200_resources_item_attributes_item
