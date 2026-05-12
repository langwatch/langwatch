from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_dataset_by_slug_or_id_records_body_entries_item import (
        PostApiDatasetBySlugOrIdRecordsBodyEntriesItem,
    )


T = TypeVar("T", bound="PostApiDatasetBySlugOrIdRecordsBody")


@_attrs_define
class PostApiDatasetBySlugOrIdRecordsBody:
    """
    Attributes:
        entries (list[PostApiDatasetBySlugOrIdRecordsBodyEntriesItem]):
    """

    entries: list[PostApiDatasetBySlugOrIdRecordsBodyEntriesItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        entries = []
        for entries_item_data in self.entries:
            entries_item = entries_item_data.to_dict()
            entries.append(entries_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "entries": entries,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dataset_by_slug_or_id_records_body_entries_item import (
            PostApiDatasetBySlugOrIdRecordsBodyEntriesItem,
        )

        d = dict(src_dict)
        entries = []
        _entries = d.pop("entries")
        for entries_item_data in _entries:
            entries_item = PostApiDatasetBySlugOrIdRecordsBodyEntriesItem.from_dict(entries_item_data)

            entries.append(entries_item)

        post_api_dataset_by_slug_or_id_records_body = cls(
            entries=entries,
        )

        post_api_dataset_by_slug_or_id_records_body.additional_properties = d
        return post_api_dataset_by_slug_or_id_records_body

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
