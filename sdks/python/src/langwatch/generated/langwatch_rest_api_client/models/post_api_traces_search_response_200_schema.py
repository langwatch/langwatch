from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_traces_search_response_200_schema_columns_item import (
        PostApiTracesSearchResponse200SchemaColumnsItem,
    )


T = TypeVar("T", bound="PostApiTracesSearchResponse200Schema")


@_attrs_define
class PostApiTracesSearchResponse200Schema:
    """Present only when 'select' is provided. Describes the resolved columns — the dotted path, its value type, and
    whether it belongs to a nested child collection — so callers can pre-allocate a typed reader.

        Attributes:
            from_ (str):
            columns (list[PostApiTracesSearchResponse200SchemaColumnsItem]):
    """

    from_: str
    columns: list[PostApiTracesSearchResponse200SchemaColumnsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from_ = self.from_

        columns = []
        for columns_item_data in self.columns:
            columns_item = columns_item_data.to_dict()
            columns.append(columns_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "from": from_,
                "columns": columns,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_traces_search_response_200_schema_columns_item import (
            PostApiTracesSearchResponse200SchemaColumnsItem,
        )

        d = dict(src_dict)
        from_ = d.pop("from")

        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = PostApiTracesSearchResponse200SchemaColumnsItem.from_dict(columns_item_data)

            columns.append(columns_item)

        post_api_traces_search_response_200_schema = cls(
            from_=from_,
            columns=columns,
        )

        post_api_traces_search_response_200_schema.additional_properties = d
        return post_api_traces_search_response_200_schema

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
