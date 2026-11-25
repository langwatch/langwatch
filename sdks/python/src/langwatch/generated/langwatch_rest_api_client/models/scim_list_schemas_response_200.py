from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.scim_list_schemas_response_200_resources_item import ScimListSchemasResponse200ResourcesItem


T = TypeVar("T", bound="ScimListSchemasResponse200")


@_attrs_define
class ScimListSchemasResponse200:
    """
    Attributes:
        schemas (list[Literal['urn:ietf:params:scim:api:messages:2.0:ListResponse']]):
        total_results (int):
        start_index (int):
        items_per_page (int):
        resources (list[ScimListSchemasResponse200ResourcesItem]):
    """

    schemas: list[Literal["urn:ietf:params:scim:api:messages:2.0:ListResponse"]]
    total_results: int
    start_index: int
    items_per_page: int
    resources: list[ScimListSchemasResponse200ResourcesItem]

    def to_dict(self) -> dict[str, Any]:
        schemas = self.schemas

        total_results = self.total_results

        start_index = self.start_index

        items_per_page = self.items_per_page

        resources = []
        for resources_item_data in self.resources:
            resources_item = resources_item_data.to_dict()
            resources.append(resources_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "schemas": schemas,
                "totalResults": total_results,
                "startIndex": start_index,
                "itemsPerPage": items_per_page,
                "Resources": resources,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_list_schemas_response_200_resources_item import ScimListSchemasResponse200ResourcesItem

        d = dict(src_dict)
        schemas = []
        _schemas = d.pop("schemas")
        for schemas_item_data in _schemas:
            schemas_item = cast(Literal["urn:ietf:params:scim:api:messages:2.0:ListResponse"], schemas_item_data)
            if schemas_item != "urn:ietf:params:scim:api:messages:2.0:ListResponse":
                raise ValueError(
                    f"schemas_item must match const 'urn:ietf:params:scim:api:messages:2.0:ListResponse', got '{schemas_item}'"
                )
            schemas.append(schemas_item)

        total_results = d.pop("totalResults")

        start_index = d.pop("startIndex")

        items_per_page = d.pop("itemsPerPage")

        resources = []
        _resources = d.pop("Resources")
        for resources_item_data in _resources:
            resources_item = ScimListSchemasResponse200ResourcesItem.from_dict(resources_item_data)

            resources.append(resources_item)

        scim_list_schemas_response_200 = cls(
            schemas=schemas,
            total_results=total_results,
            start_index=start_index,
            items_per_page=items_per_page,
            resources=resources,
        )

        return scim_list_schemas_response_200
