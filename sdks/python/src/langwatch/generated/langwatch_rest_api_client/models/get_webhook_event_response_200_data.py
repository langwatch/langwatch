from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_webhook_event_response_200_data_data import GetWebhookEventResponse200DataData


T = TypeVar("T", bound="GetWebhookEventResponse200Data")


@_attrs_define
class GetWebhookEventResponse200Data:
    """
    Attributes:
        id (str):
        type_ (str):
        created (str):
        schema_version (str):
        data (GetWebhookEventResponse200DataData):
    """

    id: str
    type_: str
    created: str
    schema_version: str
    data: GetWebhookEventResponse200DataData
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
        from ..models.get_webhook_event_response_200_data_data import GetWebhookEventResponse200DataData

        d = dict(src_dict)
        id = d.pop("id")

        type_ = d.pop("type")

        created = d.pop("created")

        schema_version = d.pop("schema_version")

        data = GetWebhookEventResponse200DataData.from_dict(d.pop("data"))

        get_webhook_event_response_200_data = cls(
            id=id,
            type_=type_,
            created=created,
            schema_version=schema_version,
            data=data,
        )

        get_webhook_event_response_200_data.additional_properties = d
        return get_webhook_event_response_200_data

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
