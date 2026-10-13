from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_v1_query_reference_response_200_lwql_endpoints_item_method import (
    GetApiV1QueryReferenceResponse200LwqlEndpointsItemMethod,
)

T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200LwqlEndpointsItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200LwqlEndpointsItem:
    """
    Attributes:
        method (GetApiV1QueryReferenceResponse200LwqlEndpointsItemMethod):
        path (str):
        description (str):
    """

    method: GetApiV1QueryReferenceResponse200LwqlEndpointsItemMethod
    path: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        method = self.method.value

        path = self.path

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "method": method,
                "path": path,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        method = GetApiV1QueryReferenceResponse200LwqlEndpointsItemMethod(d.pop("method"))

        path = d.pop("path")

        description = d.pop("description")

        get_api_v1_query_reference_response_200_lwql_endpoints_item = cls(
            method=method,
            path=path,
            description=description,
        )

        return get_api_v1_query_reference_response_200_lwql_endpoints_item
