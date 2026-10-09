from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_experiments_by_slug_versions_response_200_versions_item import (
        GetApiExperimentsBySlugVersionsResponse200VersionsItem,
    )


T = TypeVar("T", bound="GetApiExperimentsBySlugVersionsResponse200")


@_attrs_define
class GetApiExperimentsBySlugVersionsResponse200:
    """
    Attributes:
        versions (list[GetApiExperimentsBySlugVersionsResponse200VersionsItem]): Newest first, by `counterVersion`
        next_cursor (int | None): Pass as `cursor` to read the next page, null on the last one
    """

    versions: list[GetApiExperimentsBySlugVersionsResponse200VersionsItem]
    next_cursor: int | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        versions = []
        for versions_item_data in self.versions:
            versions_item = versions_item_data.to_dict()
            versions.append(versions_item)

        next_cursor: int | None
        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "versions": versions,
                "nextCursor": next_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_by_slug_versions_response_200_versions_item import (
            GetApiExperimentsBySlugVersionsResponse200VersionsItem,
        )

        d = dict(src_dict)
        versions = []
        _versions = d.pop("versions")
        for versions_item_data in _versions:
            versions_item = GetApiExperimentsBySlugVersionsResponse200VersionsItem.from_dict(versions_item_data)

            versions.append(versions_item)

        def _parse_next_cursor(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))

        get_api_experiments_by_slug_versions_response_200 = cls(
            versions=versions,
            next_cursor=next_cursor,
        )

        get_api_experiments_by_slug_versions_response_200.additional_properties = d
        return get_api_experiments_by_slug_versions_response_200

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
