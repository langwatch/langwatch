from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_list_schemas_response_200_resources_item_attributes_item import (
        ScimListSchemasResponse200ResourcesItemAttributesItem,
    )
    from ..models.scim_list_schemas_response_200_resources_item_meta import ScimListSchemasResponse200ResourcesItemMeta


T = TypeVar("T", bound="ScimListSchemasResponse200ResourcesItem")


@_attrs_define
class ScimListSchemasResponse200ResourcesItem:
    """
    Attributes:
        schemas (list[str] | Unset): The SCIM schema URNs this resource conforms to.
        id (str | Unset): The schema URN.
        name (str | Unset):
        description (str | Unset):
        attributes (list[ScimListSchemasResponse200ResourcesItemAttributesItem] | Unset): The attribute definitions, in
            the shape RFC 7643 section 7 gives them.
        meta (ScimListSchemasResponse200ResourcesItemMeta | Unset):
    """

    schemas: list[str] | Unset = UNSET
    id: str | Unset = UNSET
    name: str | Unset = UNSET
    description: str | Unset = UNSET
    attributes: list[ScimListSchemasResponse200ResourcesItemAttributesItem] | Unset = UNSET
    meta: ScimListSchemasResponse200ResourcesItemMeta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas: list[str] | Unset = UNSET
        if not isinstance(self.schemas, Unset):
            schemas = self.schemas

        id = self.id

        name = self.name

        description = self.description

        attributes: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.attributes, Unset):
            attributes = []
            for attributes_item_data in self.attributes:
                attributes_item = attributes_item_data.to_dict()
                attributes.append(attributes_item)

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if schemas is not UNSET:
            field_dict["schemas"] = schemas
        if id is not UNSET:
            field_dict["id"] = id
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if attributes is not UNSET:
            field_dict["attributes"] = attributes
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_list_schemas_response_200_resources_item_attributes_item import (
            ScimListSchemasResponse200ResourcesItemAttributesItem,
        )
        from ..models.scim_list_schemas_response_200_resources_item_meta import (
            ScimListSchemasResponse200ResourcesItemMeta,
        )

        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas", UNSET))

        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        _attributes = d.pop("attributes", UNSET)
        attributes: list[ScimListSchemasResponse200ResourcesItemAttributesItem] | Unset = UNSET
        if _attributes is not UNSET:
            attributes = []
            for attributes_item_data in _attributes:
                attributes_item = ScimListSchemasResponse200ResourcesItemAttributesItem.from_dict(attributes_item_data)

                attributes.append(attributes_item)

        _meta = d.pop("meta", UNSET)
        meta: ScimListSchemasResponse200ResourcesItemMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = ScimListSchemasResponse200ResourcesItemMeta.from_dict(_meta)

        scim_list_schemas_response_200_resources_item = cls(
            schemas=schemas,
            id=id,
            name=name,
            description=description,
            attributes=attributes,
            meta=meta,
        )

        scim_list_schemas_response_200_resources_item.additional_properties = d
        return scim_list_schemas_response_200_resources_item

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
