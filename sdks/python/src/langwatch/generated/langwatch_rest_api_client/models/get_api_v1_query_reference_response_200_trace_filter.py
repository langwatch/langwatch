from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_v1_query_reference_response_200_trace_filter_dynamic_prefixes_item import (
        GetApiV1QueryReferenceResponse200TraceFilterDynamicPrefixesItem,
    )
    from ..models.get_api_v1_query_reference_response_200_trace_filter_endpoints_item import (
        GetApiV1QueryReferenceResponse200TraceFilterEndpointsItem,
    )
    from ..models.get_api_v1_query_reference_response_200_trace_filter_fields_item import (
        GetApiV1QueryReferenceResponse200TraceFilterFieldsItem,
    )


T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200TraceFilter")


@_attrs_define
class GetApiV1QueryReferenceResponse200TraceFilter:
    """
    Attributes:
        syntax (str):
        fields (list[GetApiV1QueryReferenceResponse200TraceFilterFieldsItem]):
        dynamic_prefixes (list[GetApiV1QueryReferenceResponse200TraceFilterDynamicPrefixesItem]):
        endpoints (list[GetApiV1QueryReferenceResponse200TraceFilterEndpointsItem]):
    """

    syntax: str
    fields: list[GetApiV1QueryReferenceResponse200TraceFilterFieldsItem]
    dynamic_prefixes: list[GetApiV1QueryReferenceResponse200TraceFilterDynamicPrefixesItem]
    endpoints: list[GetApiV1QueryReferenceResponse200TraceFilterEndpointsItem]

    def to_dict(self) -> dict[str, Any]:
        syntax = self.syntax

        fields = []
        for fields_item_data in self.fields:
            fields_item = fields_item_data.to_dict()
            fields.append(fields_item)

        dynamic_prefixes = []
        for dynamic_prefixes_item_data in self.dynamic_prefixes:
            dynamic_prefixes_item = dynamic_prefixes_item_data.to_dict()
            dynamic_prefixes.append(dynamic_prefixes_item)

        endpoints = []
        for endpoints_item_data in self.endpoints:
            endpoints_item = endpoints_item_data.to_dict()
            endpoints.append(endpoints_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "syntax": syntax,
                "fields": fields,
                "dynamicPrefixes": dynamic_prefixes,
                "endpoints": endpoints,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_query_reference_response_200_trace_filter_dynamic_prefixes_item import (
            GetApiV1QueryReferenceResponse200TraceFilterDynamicPrefixesItem,
        )
        from ..models.get_api_v1_query_reference_response_200_trace_filter_endpoints_item import (
            GetApiV1QueryReferenceResponse200TraceFilterEndpointsItem,
        )
        from ..models.get_api_v1_query_reference_response_200_trace_filter_fields_item import (
            GetApiV1QueryReferenceResponse200TraceFilterFieldsItem,
        )

        d = dict(src_dict)
        syntax = d.pop("syntax")

        fields = []
        _fields = d.pop("fields")
        for fields_item_data in _fields:
            fields_item = GetApiV1QueryReferenceResponse200TraceFilterFieldsItem.from_dict(fields_item_data)

            fields.append(fields_item)

        dynamic_prefixes = []
        _dynamic_prefixes = d.pop("dynamicPrefixes")
        for dynamic_prefixes_item_data in _dynamic_prefixes:
            dynamic_prefixes_item = GetApiV1QueryReferenceResponse200TraceFilterDynamicPrefixesItem.from_dict(
                dynamic_prefixes_item_data
            )

            dynamic_prefixes.append(dynamic_prefixes_item)

        endpoints = []
        _endpoints = d.pop("endpoints")
        for endpoints_item_data in _endpoints:
            endpoints_item = GetApiV1QueryReferenceResponse200TraceFilterEndpointsItem.from_dict(endpoints_item_data)

            endpoints.append(endpoints_item)

        get_api_v1_query_reference_response_200_trace_filter = cls(
            syntax=syntax,
            fields=fields,
            dynamic_prefixes=dynamic_prefixes,
            endpoints=endpoints,
        )

        return get_api_v1_query_reference_response_200_trace_filter
