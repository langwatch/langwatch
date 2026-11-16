from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        type_ = self.type_

        collection = self.collection

        field_dict: dict[str, Any] = {}

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

        return post_api_traces_search_response_200_schema_columns_item
