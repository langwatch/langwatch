from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_list_resource_types_response_200_resources_item_meta import (
        ScimListResourceTypesResponse200ResourcesItemMeta,
    )


T = TypeVar("T", bound="ScimListResourceTypesResponse200ResourcesItem")


@_attrs_define
class ScimListResourceTypesResponse200ResourcesItem:
    """
    Attributes:
        schemas (list[str] | Unset): The SCIM schema URNs this resource conforms to.
        id (str | Unset):
        name (str | Unset):
        endpoint (str | Unset):
        schema (str | Unset): The URN of the schema this resource type is defined by.
        meta (ScimListResourceTypesResponse200ResourcesItemMeta | Unset):
    """

    schemas: list[str] | Unset = UNSET
    id: str | Unset = UNSET
    name: str | Unset = UNSET
    endpoint: str | Unset = UNSET
    schema: str | Unset = UNSET
    meta: ScimListResourceTypesResponse200ResourcesItemMeta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas: list[str] | Unset = UNSET
        if not isinstance(self.schemas, Unset):
            schemas = self.schemas

        id = self.id

        name = self.name

        endpoint = self.endpoint

        schema = self.schema

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
        if endpoint is not UNSET:
            field_dict["endpoint"] = endpoint
        if schema is not UNSET:
            field_dict["schema"] = schema
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_list_resource_types_response_200_resources_item_meta import (
            ScimListResourceTypesResponse200ResourcesItemMeta,
        )

        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas", UNSET))

        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        endpoint = d.pop("endpoint", UNSET)

        schema = d.pop("schema", UNSET)

        _meta = d.pop("meta", UNSET)
        meta: ScimListResourceTypesResponse200ResourcesItemMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = ScimListResourceTypesResponse200ResourcesItemMeta.from_dict(_meta)

        scim_list_resource_types_response_200_resources_item = cls(
            schemas=schemas,
            id=id,
            name=name,
            endpoint=endpoint,
            schema=schema,
            meta=meta,
        )

        scim_list_resource_types_response_200_resources_item.additional_properties = d
        return scim_list_resource_types_response_200_resources_item

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
