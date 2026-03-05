from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_traces_search_body_filters_metadata_value_type_2_additional_property import (
        PostApiTracesSearchBodyFiltersMetadataValueType2AdditionalProperty,
    )


T = TypeVar("T", bound="PostApiTracesSearchBodyFiltersMetadataValueType2")


@_attrs_define
class PostApiTracesSearchBodyFiltersMetadataValueType2:
    """ """

    additional_properties: dict[str, PostApiTracesSearchBodyFiltersMetadataValueType2AdditionalProperty] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_traces_search_body_filters_metadata_value_type_2_additional_property import (
            PostApiTracesSearchBodyFiltersMetadataValueType2AdditionalProperty,
        )

        d = dict(src_dict)
        post_api_traces_search_body_filters_metadata_value_type_2 = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():
            additional_property = PostApiTracesSearchBodyFiltersMetadataValueType2AdditionalProperty.from_dict(
                prop_dict
            )

            additional_properties[prop_name] = additional_property

        post_api_traces_search_body_filters_metadata_value_type_2.additional_properties = additional_properties
        return post_api_traces_search_body_filters_metadata_value_type_2

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> PostApiTracesSearchBodyFiltersMetadataValueType2AdditionalProperty:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: PostApiTracesSearchBodyFiltersMetadataValueType2AdditionalProperty) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
