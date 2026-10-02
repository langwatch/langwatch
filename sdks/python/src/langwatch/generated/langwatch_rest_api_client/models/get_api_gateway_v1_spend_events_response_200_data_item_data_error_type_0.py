from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0")


@_attrs_define
class GetApiGatewayV1SpendEventsResponse200DataItemDataErrorType0:
    """
    Attributes:
        class_ (str):
        http_status (int | None):
    """

    class_: str
    http_status: int | None

    def to_dict(self) -> dict[str, Any]:
        class_ = self.class_

        http_status: int | None
        http_status = self.http_status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "class": class_,
                "http_status": http_status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        class_ = d.pop("class")

        def _parse_http_status(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        http_status = _parse_http_status(d.pop("http_status"))

        get_api_gateway_v1_spend_events_response_200_data_item_data_error_type_0 = cls(
            class_=class_,
            http_status=http_status,
        )

        return get_api_gateway_v1_spend_events_response_200_data_item_data_error_type_0
