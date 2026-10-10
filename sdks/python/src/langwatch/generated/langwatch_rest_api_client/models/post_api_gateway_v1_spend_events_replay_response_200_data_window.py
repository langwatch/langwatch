from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiGatewayV1SpendEventsReplayResponse200DataWindow")


@_attrs_define
class PostApiGatewayV1SpendEventsReplayResponse200DataWindow:
    """
    Attributes:
        from_ (str):
        to (str):
    """

    from_: str
    to: str

    def to_dict(self) -> dict[str, Any]:
        from_ = self.from_

        to = self.to

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "from": from_,
                "to": to,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        from_ = d.pop("from")

        to = d.pop("to")

        post_api_gateway_v1_spend_events_replay_response_200_data_window = cls(
            from_=from_,
            to=to,
        )

        return post_api_gateway_v1_spend_events_replay_response_200_data_window
