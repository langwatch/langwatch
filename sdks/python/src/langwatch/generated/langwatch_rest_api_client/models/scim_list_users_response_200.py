from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.scim_list_users_response_200_resources_item import ScimListUsersResponse200ResourcesItem


T = TypeVar("T", bound="ScimListUsersResponse200")


@_attrs_define
class ScimListUsersResponse200:
    """
    Attributes:
        schemas (list[str] | Unset): The SCIM schema URNs this resource conforms to.
        total_results (int | Unset): How many resources match, before pagination.
        start_index (int | Unset):
        items_per_page (int | Unset):
        resources (list[ScimListUsersResponse200ResourcesItem] | Unset):
    """

    schemas: list[str] | Unset = UNSET
    total_results: int | Unset = UNSET
    start_index: int | Unset = UNSET
    items_per_page: int | Unset = UNSET
    resources: list[ScimListUsersResponse200ResourcesItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schemas: list[str] | Unset = UNSET
        if not isinstance(self.schemas, Unset):
            schemas = self.schemas

        total_results = self.total_results

        start_index = self.start_index

        items_per_page = self.items_per_page

        resources: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.resources, Unset):
            resources = []
            for resources_item_data in self.resources:
                resources_item = resources_item_data.to_dict()
                resources.append(resources_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if schemas is not UNSET:
            field_dict["schemas"] = schemas
        if total_results is not UNSET:
            field_dict["totalResults"] = total_results
        if start_index is not UNSET:
            field_dict["startIndex"] = start_index
        if items_per_page is not UNSET:
            field_dict["itemsPerPage"] = items_per_page
        if resources is not UNSET:
            field_dict["Resources"] = resources

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.scim_list_users_response_200_resources_item import ScimListUsersResponse200ResourcesItem

        d = dict(src_dict)
        schemas = cast(list[str], d.pop("schemas", UNSET))

        total_results = d.pop("totalResults", UNSET)

        start_index = d.pop("startIndex", UNSET)

        items_per_page = d.pop("itemsPerPage", UNSET)

        _resources = d.pop("Resources", UNSET)
        resources: list[ScimListUsersResponse200ResourcesItem] | Unset = UNSET
        if _resources is not UNSET:
            resources = []
            for resources_item_data in _resources:
                resources_item = ScimListUsersResponse200ResourcesItem.from_dict(resources_item_data)

                resources.append(resources_item)

        scim_list_users_response_200 = cls(
            schemas=schemas,
            total_results=total_results,
            start_index=start_index,
            items_per_page=items_per_page,
            resources=resources,
        )

        scim_list_users_response_200.additional_properties = d
        return scim_list_users_response_200

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
