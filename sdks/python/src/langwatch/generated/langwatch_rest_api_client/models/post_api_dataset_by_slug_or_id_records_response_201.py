from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_dataset_by_slug_or_id_records_response_201_data_item import (
        PostApiDatasetBySlugOrIdRecordsResponse201DataItem,
    )


T = TypeVar("T", bound="PostApiDatasetBySlugOrIdRecordsResponse201")


@_attrs_define
class PostApiDatasetBySlugOrIdRecordsResponse201:
    """
    Attributes:
        data (list[PostApiDatasetBySlugOrIdRecordsResponse201DataItem]):
    """

    data: list[PostApiDatasetBySlugOrIdRecordsResponse201DataItem]

    def to_dict(self) -> dict[str, Any]:
        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dataset_by_slug_or_id_records_response_201_data_item import (
            PostApiDatasetBySlugOrIdRecordsResponse201DataItem,
        )

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = PostApiDatasetBySlugOrIdRecordsResponse201DataItem.from_dict(data_item_data)

            data.append(data_item)

        post_api_dataset_by_slug_or_id_records_response_201 = cls(
            data=data,
        )

        return post_api_dataset_by_slug_or_id_records_response_201
