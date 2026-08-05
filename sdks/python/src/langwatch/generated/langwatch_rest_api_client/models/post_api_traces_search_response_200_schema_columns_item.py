from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiTracesSearchResponse200SchemaColumnsItem")


@_attrs_define
class PostApiTracesSearchResponse200SchemaColumnsItem:
    """
    Attributes:
        path (str):
        type_ (str):
        collection (bool):
    """

    path: str
    type_: str
    collection: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        type_ = self.type_

        collection = self.collection

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "path": path,
                "type": type_,
                "collection": collection,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        type_ = d.pop("type")

        collection = d.pop("collection")

        post_api_traces_search_response_200_schema_columns_item = cls(
            path=path,
            type_=type_,
            collection=collection,
        )

        post_api_traces_search_response_200_schema_columns_item.additional_properties = d
        return post_api_traces_search_response_200_schema_columns_item

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
