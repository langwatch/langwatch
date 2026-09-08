from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiExperimentsBySlugWorkbenchStateResponse200Type1")


@_attrs_define
class GetApiExperimentsBySlugWorkbenchStateResponse200Type1:
    """
    Attributes:
        id (str):
        slug (str):
        version (int):
        updated_at (str): ISO 8601 timestamp of the last save
    """

    id: str
    slug: str
    version: int
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        slug = self.slug

        version = self.version

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "version": version,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        version = d.pop("version")

        updated_at = d.pop("updatedAt")

        get_api_experiments_by_slug_workbench_state_response_200_type_1 = cls(
            id=id,
            slug=slug,
            version=version,
            updated_at=updated_at,
        )

        get_api_experiments_by_slug_workbench_state_response_200_type_1.additional_properties = d
        return get_api_experiments_by_slug_workbench_state_response_200_type_1

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
