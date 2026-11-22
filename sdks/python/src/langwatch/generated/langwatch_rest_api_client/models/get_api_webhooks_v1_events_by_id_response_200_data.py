from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_webhooks_v1_events_by_id_response_200_data_data import (
        GetApiWebhooksV1EventsByIdResponse200DataData,
    )


T = TypeVar("T", bound="GetApiWebhooksV1EventsByIdResponse200Data")


@_attrs_define
class GetApiWebhooksV1EventsByIdResponse200Data:
    """
    Attributes:
        id (str):
        type_ (str):
        created (str):
        schema_version (str):
        data (GetApiWebhooksV1EventsByIdResponse200DataData):
    """

    id: str
    type_: str
    created: str
    schema_version: str
    data: GetApiWebhooksV1EventsByIdResponse200DataData

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        created = self.created

        schema_version = self.schema_version

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "created": created,
                "schema_version": schema_version,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_webhooks_v1_events_by_id_response_200_data_data import (
            GetApiWebhooksV1EventsByIdResponse200DataData,
        )

        d = dict(src_dict)
        id = d.pop("id")

        type_ = d.pop("type")

        created = d.pop("created")

        schema_version = d.pop("schema_version")

        data = GetApiWebhooksV1EventsByIdResponse200DataData.from_dict(d.pop("data"))

        get_api_webhooks_v1_events_by_id_response_200_data = cls(
            id=id,
            type_=type_,
            created=created,
            schema_version=schema_version,
            data=data,
        )

        return get_api_webhooks_v1_events_by_id_response_200_data
