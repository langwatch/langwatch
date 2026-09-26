from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_analytics_timeseries_body_filters_additional_property_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_additional_property_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType2,
    )


T = TypeVar("T", bound="PostApiAnalyticsTimeseriesBodyFilters")


@_attrs_define
class PostApiAnalyticsTimeseriesBodyFilters:
    """ """

    additional_properties: dict[
        str,
        list[str]
        | PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1
        | PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType2,
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_analytics_timeseries_body_filters_additional_property_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1,
        )

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, list):
                field_dict[prop_name] = prop

            elif isinstance(prop, PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_analytics_timeseries_body_filters_additional_property_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_additional_property_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType2,
        )

        d = dict(src_dict)
        post_api_analytics_timeseries_body_filters = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> (
                list[str]
                | PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1
                | PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType2
            ):
                try:
                    if not isinstance(data, list):
                        raise TypeError()
                    additional_property_type_0 = cast(list[str], data)

                    return additional_property_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_1 = PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1.from_dict(
                        data
                    )

                    return additional_property_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_2 = PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType2.from_dict(
                    data
                )

                return additional_property_type_2

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        post_api_analytics_timeseries_body_filters.additional_properties = additional_properties
        return post_api_analytics_timeseries_body_filters

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> (
        list[str]
        | PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1
        | PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType2
    ):
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: list[str]
        | PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType1
        | PostApiAnalyticsTimeseriesBodyFiltersAdditionalPropertyType2,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
