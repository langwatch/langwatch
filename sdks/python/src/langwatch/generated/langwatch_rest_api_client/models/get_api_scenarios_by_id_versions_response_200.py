from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_scenarios_by_id_versions_response_200_versions_item import (
        GetApiScenariosByIdVersionsResponse200VersionsItem,
    )


T = TypeVar("T", bound="GetApiScenariosByIdVersionsResponse200")


@_attrs_define
class GetApiScenariosByIdVersionsResponse200:
    """
    Attributes:
        versions (list[GetApiScenariosByIdVersionsResponse200VersionsItem]):
        next_cursor (int | None): Pass as cursor to read the page below this one. Null on the last page.
    """

    versions: list[GetApiScenariosByIdVersionsResponse200VersionsItem]
    next_cursor: int | None

    def to_dict(self) -> dict[str, Any]:
        versions = []
        for versions_item_data in self.versions:
            versions_item = versions_item_data.to_dict()
            versions.append(versions_item)

        next_cursor: int | None
        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "versions": versions,
                "nextCursor": next_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_scenarios_by_id_versions_response_200_versions_item import (
            GetApiScenariosByIdVersionsResponse200VersionsItem,
        )

        d = dict(src_dict)
        versions = []
        _versions = d.pop("versions")
        for versions_item_data in _versions:
            versions_item = GetApiScenariosByIdVersionsResponse200VersionsItem.from_dict(versions_item_data)

            versions.append(versions_item)

        def _parse_next_cursor(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))

        get_api_scenarios_by_id_versions_response_200 = cls(
            versions=versions,
            next_cursor=next_cursor,
        )

        return get_api_scenarios_by_id_versions_response_200
