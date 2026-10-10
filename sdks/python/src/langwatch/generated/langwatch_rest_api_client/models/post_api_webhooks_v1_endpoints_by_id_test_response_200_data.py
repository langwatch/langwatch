from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiWebhooksV1EndpointsByIdTestResponse200Data")


@_attrs_define
class PostApiWebhooksV1EndpointsByIdTestResponse200Data:
    """
    Attributes:
        delivered (bool):
        response_status (int | None):
        response_body (str | Unset):
        error (str | Unset):
    """

    delivered: bool
    response_status: int | None
    response_body: str | Unset = UNSET
    error: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        delivered = self.delivered

        response_status: int | None
        response_status = self.response_status

        response_body = self.response_body

        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "delivered": delivered,
                "response_status": response_status,
            }
        )
        if response_body is not UNSET:
            field_dict["response_body"] = response_body
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        delivered = d.pop("delivered")

        def _parse_response_status(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        response_status = _parse_response_status(d.pop("response_status"))

        response_body = d.pop("response_body", UNSET)

        error = d.pop("error", UNSET)

        post_api_webhooks_v1_endpoints_by_id_test_response_200_data = cls(
            delivered=delivered,
            response_status=response_status,
            response_body=response_body,
            error=error,
        )

        return post_api_webhooks_v1_endpoints_by_id_test_response_200_data
