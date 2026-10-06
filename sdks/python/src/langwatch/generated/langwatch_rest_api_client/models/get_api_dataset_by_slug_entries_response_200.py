from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_dataset_by_slug_entries_response_200_data_item import (
        GetApiDatasetBySlugEntriesResponse200DataItem,
    )
    from ..models.get_api_dataset_by_slug_entries_response_200_dataset import (
        GetApiDatasetBySlugEntriesResponse200Dataset,
    )
    from ..models.get_api_dataset_by_slug_entries_response_200_pagination import (
        GetApiDatasetBySlugEntriesResponse200Pagination,
    )


T = TypeVar("T", bound="GetApiDatasetBySlugEntriesResponse200")


@_attrs_define
class GetApiDatasetBySlugEntriesResponse200:
    """
    Attributes:
        data (list[GetApiDatasetBySlugEntriesResponse200DataItem]):
        pagination (GetApiDatasetBySlugEntriesResponse200Pagination):
        dataset (GetApiDatasetBySlugEntriesResponse200Dataset | Unset):
    """

    data: list[GetApiDatasetBySlugEntriesResponse200DataItem]
    pagination: GetApiDatasetBySlugEntriesResponse200Pagination
    dataset: GetApiDatasetBySlugEntriesResponse200Dataset | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        pagination = self.pagination.to_dict()

        dataset: dict[str, Any] | Unset = UNSET
        if not isinstance(self.dataset, Unset):
            dataset = self.dataset.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
                "pagination": pagination,
            }
        )
        if dataset is not UNSET:
            field_dict["dataset"] = dataset

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_dataset_by_slug_entries_response_200_data_item import (
            GetApiDatasetBySlugEntriesResponse200DataItem,
        )
        from ..models.get_api_dataset_by_slug_entries_response_200_dataset import (
            GetApiDatasetBySlugEntriesResponse200Dataset,
        )
        from ..models.get_api_dataset_by_slug_entries_response_200_pagination import (
            GetApiDatasetBySlugEntriesResponse200Pagination,
        )

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = GetApiDatasetBySlugEntriesResponse200DataItem.from_dict(data_item_data)

            data.append(data_item)

        pagination = GetApiDatasetBySlugEntriesResponse200Pagination.from_dict(d.pop("pagination"))

        _dataset = d.pop("dataset", UNSET)
        dataset: GetApiDatasetBySlugEntriesResponse200Dataset | Unset
        if isinstance(_dataset, Unset):
            dataset = UNSET
        else:
            dataset = GetApiDatasetBySlugEntriesResponse200Dataset.from_dict(_dataset)

        get_api_dataset_by_slug_entries_response_200 = cls(
            data=data,
            pagination=pagination,
            dataset=dataset,
        )

        return get_api_dataset_by_slug_entries_response_200
