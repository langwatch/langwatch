from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_query_reference_response_200_lwql_endpoints_item import (
        GetApiV1QueryReferenceResponse200LwqlEndpointsItem,
    )
    from ..models.get_api_v1_query_reference_response_200_lwql_limits import GetApiV1QueryReferenceResponse200LwqlLimits
    from ..models.get_api_v1_query_reference_response_200_lwql_schema import GetApiV1QueryReferenceResponse200LwqlSchema


T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200Lwql")


@_attrs_define
class GetApiV1QueryReferenceResponse200Lwql:
    """
    Attributes:
        enabled (bool):
        schema (GetApiV1QueryReferenceResponse200LwqlSchema):
        limits (GetApiV1QueryReferenceResponse200LwqlLimits):
        endpoints (list[GetApiV1QueryReferenceResponse200LwqlEndpointsItem]):
    """

    enabled: bool
    schema: GetApiV1QueryReferenceResponse200LwqlSchema
    limits: GetApiV1QueryReferenceResponse200LwqlLimits
    endpoints: list[GetApiV1QueryReferenceResponse200LwqlEndpointsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        schema = self.schema.to_dict()

        limits = self.limits.to_dict()

        endpoints = []
        for endpoints_item_data in self.endpoints:
            endpoints_item = endpoints_item_data.to_dict()
            endpoints.append(endpoints_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "enabled": enabled,
                "schema": schema,
                "limits": limits,
                "endpoints": endpoints,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_query_reference_response_200_lwql_endpoints_item import (
            GetApiV1QueryReferenceResponse200LwqlEndpointsItem,
        )
        from ..models.get_api_v1_query_reference_response_200_lwql_limits import (
            GetApiV1QueryReferenceResponse200LwqlLimits,
        )
        from ..models.get_api_v1_query_reference_response_200_lwql_schema import (
            GetApiV1QueryReferenceResponse200LwqlSchema,
        )

        d = dict(src_dict)
        enabled = d.pop("enabled")

        schema = GetApiV1QueryReferenceResponse200LwqlSchema.from_dict(d.pop("schema"))

        limits = GetApiV1QueryReferenceResponse200LwqlLimits.from_dict(d.pop("limits"))

        endpoints = []
        _endpoints = d.pop("endpoints")
        for endpoints_item_data in _endpoints:
            endpoints_item = GetApiV1QueryReferenceResponse200LwqlEndpointsItem.from_dict(endpoints_item_data)

            endpoints.append(endpoints_item)

        get_api_v1_query_reference_response_200_lwql = cls(
            enabled=enabled,
            schema=schema,
            limits=limits,
            endpoints=endpoints,
        )

        get_api_v1_query_reference_response_200_lwql.additional_properties = d
        return get_api_v1_query_reference_response_200_lwql

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
