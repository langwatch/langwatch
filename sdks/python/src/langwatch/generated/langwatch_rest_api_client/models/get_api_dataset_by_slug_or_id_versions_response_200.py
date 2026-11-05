from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_dataset_by_slug_or_id_versions_response_200_data_item import (
        GetApiDatasetBySlugOrIdVersionsResponse200DataItem,
    )


T = TypeVar("T", bound="GetApiDatasetBySlugOrIdVersionsResponse200")


@_attrs_define
class GetApiDatasetBySlugOrIdVersionsResponse200:
    """
    Attributes:
        data (list[GetApiDatasetBySlugOrIdVersionsResponse200DataItem]):
        restorable (bool):
    """

    data: list[GetApiDatasetBySlugOrIdVersionsResponse200DataItem]
    restorable: bool

    def to_dict(self) -> dict[str, Any]:
        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        restorable = self.restorable

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
                "restorable": restorable,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dataset_by_slug_or_id_versions_response_200_data_item import (
            GetApiDatasetBySlugOrIdVersionsResponse200DataItem,
        )

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = GetApiDatasetBySlugOrIdVersionsResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        restorable = d.pop("restorable")

        get_api_dataset_by_slug_or_id_versions_response_200 = cls(
            data=data,
            restorable=restorable,
        )

        return get_api_dataset_by_slug_or_id_versions_response_200
