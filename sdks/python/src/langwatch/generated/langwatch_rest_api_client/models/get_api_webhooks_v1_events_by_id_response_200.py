from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_webhooks_v1_events_by_id_response_200_data import GetApiWebhooksV1EventsByIdResponse200Data


T = TypeVar("T", bound="GetApiWebhooksV1EventsByIdResponse200")


@_attrs_define
class GetApiWebhooksV1EventsByIdResponse200:
    """
    Attributes:
        data (GetApiWebhooksV1EventsByIdResponse200Data):
    """

    data: GetApiWebhooksV1EventsByIdResponse200Data

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
        from ..models.get_api_webhooks_v1_events_by_id_response_200_data import (
            GetApiWebhooksV1EventsByIdResponse200Data,
        )

        d = dict(src_dict)
        data = GetApiWebhooksV1EventsByIdResponse200Data.from_dict(d.pop("data"))

        get_api_webhooks_v1_events_by_id_response_200 = cls(
            data=data,
        )

        return get_api_webhooks_v1_events_by_id_response_200
