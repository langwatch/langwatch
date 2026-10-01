from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ScimListResourceTypesResponse200ResourcesItemMeta")


@_attrs_define
class ScimListResourceTypesResponse200ResourcesItemMeta:
    """
    Attributes:
        resource_type (Literal['ResourceType']):
        location (str):
    """

    resource_type: Literal["ResourceType"]
    location: str

    def to_dict(self) -> dict[str, Any]:
        resource_type = self.resource_type

        location = self.location

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "resourceType": resource_type,
                "location": location,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        resource_type = cast(Literal["ResourceType"], d.pop("resourceType"))
        if resource_type != "ResourceType":
            raise ValueError(f"resourceType must match const 'ResourceType', got '{resource_type}'")

        location = d.pop("location")

        scim_list_resource_types_response_200_resources_item_meta = cls(
            resource_type=resource_type,
            location=location,
        )

        return scim_list_resource_types_response_200_resources_item_meta
