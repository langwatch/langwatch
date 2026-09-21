from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_webhooks_v1_events_response_200_data_item_data import (
        GetApiWebhooksV1EventsResponse200DataItemData,
    )


T = TypeVar("T", bound="GetApiWebhooksV1EventsResponse200DataItem")


@_attrs_define
class GetApiWebhooksV1EventsResponse200DataItem:
    """
    Attributes:
        id (str):
        type_ (str):
        created (str):
        schema_version (str):
        data (GetApiWebhooksV1EventsResponse200DataItemData):
    """

    id: str
    type_: str
    created: str
    schema_version: str
    data: GetApiWebhooksV1EventsResponse200DataItemData
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        created = self.created

        schema_version = self.schema_version

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.get_api_webhooks_v1_events_response_200_data_item_data import (
            GetApiWebhooksV1EventsResponse200DataItemData,
        )

        d = dict(src_dict)
        id = d.pop("id")

        type_ = d.pop("type")

        created = d.pop("created")

        schema_version = d.pop("schema_version")

        data = GetApiWebhooksV1EventsResponse200DataItemData.from_dict(d.pop("data"))

        get_api_webhooks_v1_events_response_200_data_item = cls(
            id=id,
            type_=type_,
            created=created,
            schema_version=schema_version,
            data=data,
        )

        get_api_webhooks_v1_events_response_200_data_item.additional_properties = d
        return get_api_webhooks_v1_events_response_200_data_item

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
