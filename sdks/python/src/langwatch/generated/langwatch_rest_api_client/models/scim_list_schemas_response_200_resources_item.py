from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

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
        schemas (list[Literal['urn:ietf:params:scim:schemas:core:2.0:Schema']]):
        id (str):
        name (str):
        description (str):
        attributes (list[ScimListSchemasResponse200ResourcesItemAttributesItem]):
        meta (ScimListSchemasResponse200ResourcesItemMeta):
    """

    schemas: list[Literal["urn:ietf:params:scim:schemas:core:2.0:Schema"]]
    id: str
    name: str
    description: str
    attributes: list[ScimListSchemasResponse200ResourcesItemAttributesItem]
    meta: ScimListSchemasResponse200ResourcesItemMeta

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        id = self.id

        name = self.name

        description = self.description

        attributes = []
        for attributes_item_data in self.attributes:
            attributes_item = attributes_item_data.to_dict()
            attributes.append(attributes_item)

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "schemas": schemas,
                "id": id,
                "name": name,
                "description": description,
                "attributes": attributes,
                "meta": meta,
            }
        )

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
        schemas = []
        _schemas = d.pop("schemas")
        for schemas_item_data in _schemas:
            schemas_item = cast(Literal["urn:ietf:params:scim:schemas:core:2.0:Schema"], schemas_item_data)
            if schemas_item != "urn:ietf:params:scim:schemas:core:2.0:Schema":
                raise ValueError(
                    f"schemas_item must match const 'urn:ietf:params:scim:schemas:core:2.0:Schema', got '{schemas_item}'"
                )
            schemas.append(schemas_item)

        id = d.pop("id")

        name = d.pop("name")

        description = d.pop("description")

        attributes = []
        _attributes = d.pop("attributes")
        for attributes_item_data in _attributes:
            attributes_item = ScimListSchemasResponse200ResourcesItemAttributesItem.from_dict(attributes_item_data)

            attributes.append(attributes_item)

        meta = ScimListSchemasResponse200ResourcesItemMeta.from_dict(d.pop("meta"))

        scim_list_schemas_response_200_resources_item = cls(
            schemas=schemas,
            id=id,
            name=name,
            description=description,
            attributes=attributes,
            meta=meta,
        )

        return scim_list_schemas_response_200_resources_item
