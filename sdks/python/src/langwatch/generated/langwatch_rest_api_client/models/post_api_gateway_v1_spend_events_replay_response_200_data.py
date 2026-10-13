from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_spend_events_replay_response_200_data_window import (
        PostApiGatewayV1SpendEventsReplayResponse200DataWindow,
    )


T = TypeVar("T", bound="PostApiGatewayV1SpendEventsReplayResponse200Data")


@_attrs_define
class PostApiGatewayV1SpendEventsReplayResponse200Data:
    """
    Attributes:
        endpoint_id (str):
        replay_id (str):
        replayed (int):
        window (PostApiGatewayV1SpendEventsReplayResponse200DataWindow):
    """

    endpoint_id: str
    replay_id: str
    replayed: int
    window: PostApiGatewayV1SpendEventsReplayResponse200DataWindow

    def to_dict(self) -> dict[str, Any]:
        endpoint_id = self.endpoint_id

        replay_id = self.replay_id

        replayed = self.replayed

        window = self.window.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "endpoint_id": endpoint_id,
                "replay_id": replay_id,
                "replayed": replayed,
                "window": window,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_spend_events_replay_response_200_data_window import (
            PostApiGatewayV1SpendEventsReplayResponse200DataWindow,
        )

        d = dict(src_dict)
        endpoint_id = d.pop("endpoint_id")

        replay_id = d.pop("replay_id")

        replayed = d.pop("replayed")

        window = PostApiGatewayV1SpendEventsReplayResponse200DataWindow.from_dict(d.pop("window"))

        post_api_gateway_v1_spend_events_replay_response_200_data = cls(
            endpoint_id=endpoint_id,
            replay_id=replay_id,
            replayed=replayed,
            window=window,
        )

        return post_api_gateway_v1_spend_events_replay_response_200_data
