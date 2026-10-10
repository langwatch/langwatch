from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReceiveStripeWebhookResponse200")


@_attrs_define
class ReceiveStripeWebhookResponse200:
    """
    Attributes:
        received (bool):
    """

    received: bool

    def to_dict(self) -> dict[str, Any]:
        received = self.received

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "received": received,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        received = d.pop("received")

        receive_stripe_webhook_response_200 = cls(
            received=received,
        )

        return receive_stripe_webhook_response_200
