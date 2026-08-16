from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SendWebhookEndpointTestResponse200Data")


@_attrs_define
class SendWebhookEndpointTestResponse200Data:
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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        delivered = self.delivered

        response_status: int | None
        response_status = self.response_status

        response_body = self.response_body

        error = self.error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        send_webhook_endpoint_test_response_200_data = cls(
            delivered=delivered,
            response_status=response_status,
            response_body=response_body,
            error=error,
        )

        send_webhook_endpoint_test_response_200_data.additional_properties = d
        return send_webhook_endpoint_test_response_200_data

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
