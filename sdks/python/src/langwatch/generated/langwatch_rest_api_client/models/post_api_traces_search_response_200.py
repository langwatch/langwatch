from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_traces_search_response_200_pagination import PostApiTracesSearchResponse200Pagination
    from ..models.post_api_traces_search_response_200_schema import PostApiTracesSearchResponse200Schema


T = TypeVar("T", bound="PostApiTracesSearchResponse200")


@_attrs_define
class PostApiTracesSearchResponse200:
    """
    Attributes:
        traces (list[Any]):
        pagination (PostApiTracesSearchResponse200Pagination):
        schema (PostApiTracesSearchResponse200Schema | Unset): Present only when 'select' is provided. Describes the
            resolved columns — the dotted path, its value type, and whether it belongs to a nested child collection — so
            callers can pre-allocate a typed reader.
    """

    traces: list[Any]
    pagination: PostApiTracesSearchResponse200Pagination
    schema: PostApiTracesSearchResponse200Schema | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        traces = self.traces

        pagination = self.pagination.to_dict()

        schema: dict[str, Any] | Unset = UNSET
        if not isinstance(self.schema, Unset):
            schema = self.schema.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "traces": traces,
                "pagination": pagination,
            }
        )
        if schema is not UNSET:
            field_dict["schema"] = schema

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_traces_search_response_200_pagination import PostApiTracesSearchResponse200Pagination
        from ..models.post_api_traces_search_response_200_schema import PostApiTracesSearchResponse200Schema

        d = dict(src_dict)
        traces = cast(list[Any], d.pop("traces"))

        pagination = PostApiTracesSearchResponse200Pagination.from_dict(d.pop("pagination"))

        _schema = d.pop("schema", UNSET)
        schema: PostApiTracesSearchResponse200Schema | Unset
        if isinstance(_schema, Unset):
            schema = UNSET
        else:
            schema = PostApiTracesSearchResponse200Schema.from_dict(_schema)

        post_api_traces_search_response_200 = cls(
            traces=traces,
            pagination=pagination,
            schema=schema,
        )

        post_api_traces_search_response_200.additional_properties = d
        return post_api_traces_search_response_200

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
