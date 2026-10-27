from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_spend_events_replay_response_200_data import (
        PostApiGatewayV1SpendEventsReplayResponse200Data,
    )


T = TypeVar("T", bound="PostApiGatewayV1SpendEventsReplayResponse200")


@_attrs_define
class PostApiGatewayV1SpendEventsReplayResponse200:
    """
    Attributes:
        data (PostApiGatewayV1SpendEventsReplayResponse200Data):
    """

    data: PostApiGatewayV1SpendEventsReplayResponse200Data

    def to_dict(self) -> dict[str, Any]:
        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_spend_events_replay_response_200_data import (
            PostApiGatewayV1SpendEventsReplayResponse200Data,
        )

        d = dict(src_dict)
        data = PostApiGatewayV1SpendEventsReplayResponse200Data.from_dict(d.pop("data"))

        post_api_gateway_v1_spend_events_replay_response_200 = cls(
            data=data,
        )

        return post_api_gateway_v1_spend_events_replay_response_200
