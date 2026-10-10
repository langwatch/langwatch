from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.dataset_import_column_types_item_type import DatasetImportColumnTypesItemType

T = TypeVar("T", bound="DatasetImportColumnTypesItem")


@_attrs_define
class DatasetImportColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (DatasetImportColumnTypesItemType):
        source_header (str):
    """

    name: str
    type_: DatasetImportColumnTypesItemType
    source_header: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        source_header = self.source_header

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "type": type_,
                "sourceHeader": source_header,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = DatasetImportColumnTypesItemType(d.pop("type"))

        source_header = d.pop("sourceHeader")

        dataset_import_column_types_item = cls(
            name=name,
            type_=type_,
            source_header=source_header,
        )

        dataset_import_column_types_item.additional_properties = d
        return dataset_import_column_types_item

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
