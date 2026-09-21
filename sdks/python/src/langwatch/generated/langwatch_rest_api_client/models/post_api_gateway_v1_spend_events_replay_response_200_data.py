from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        endpoint_id = self.endpoint_id

        replay_id = self.replay_id

        replayed = self.replayed

        window = self.window.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_gateway_v1_spend_events_replay_response_200_data.additional_properties = d
        return post_api_gateway_v1_spend_events_replay_response_200_data

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
