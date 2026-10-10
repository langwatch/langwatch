from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.scim_list_resource_types_response_200_resources_item_meta import (
        ScimListResourceTypesResponse200ResourcesItemMeta,
    )


T = TypeVar("T", bound="ScimListResourceTypesResponse200ResourcesItem")


@_attrs_define
class ScimListResourceTypesResponse200ResourcesItem:
    """
    Attributes:
        schemas (list[Literal['urn:ietf:params:scim:schemas:core:2.0:ResourceType']]):
        id (str):
        name (str):
        endpoint (str):
        schema (str):
        meta (ScimListResourceTypesResponse200ResourcesItemMeta):
    """

    schemas: list[Literal["urn:ietf:params:scim:schemas:core:2.0:ResourceType"]]
    id: str
    name: str
    endpoint: str
    schema: str
    meta: ScimListResourceTypesResponse200ResourcesItemMeta

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        id = self.id

        name = self.name

        endpoint = self.endpoint

        schema = self.schema

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "schemas": schemas,
                "id": id,
                "name": name,
                "endpoint": endpoint,
                "schema": schema,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_list_resource_types_response_200_resources_item_meta import (
            ScimListResourceTypesResponse200ResourcesItemMeta,
        )

        d = dict(src_dict)
        schemas = []
        _schemas = d.pop("schemas")
        for schemas_item_data in _schemas:
            schemas_item = cast(Literal["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], schemas_item_data)
            if schemas_item != "urn:ietf:params:scim:schemas:core:2.0:ResourceType":
                raise ValueError(
                    f"schemas_item must match const 'urn:ietf:params:scim:schemas:core:2.0:ResourceType', got '{schemas_item}'"
                )
            schemas.append(schemas_item)

        id = d.pop("id")

        name = d.pop("name")

        endpoint = d.pop("endpoint")

        schema = d.pop("schema")

        meta = ScimListResourceTypesResponse200ResourcesItemMeta.from_dict(d.pop("meta"))

        scim_list_resource_types_response_200_resources_item = cls(
            schemas=schemas,
            id=id,
            name=name,
            endpoint=endpoint,
            schema=schema,
            meta=meta,
        )

        return scim_list_resource_types_response_200_resources_item
