from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="ListWebhookEventTypesResponse200DataItem")


@_attrs_define
class ListWebhookEventTypesResponse200DataItem:
    """
    Attributes:
        type_ (str):
        family (str):
        schema_version (str):
        is_emitting (bool):
        description (str):
    """

    type_: str
    family: str
    schema_version: str
    is_emitting: bool
    description: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        family = self.family

        schema_version = self.schema_version

        is_emitting = self.is_emitting

        description = self.description

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "family": family,
                "schema_version": schema_version,
                "is_emitting": is_emitting,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        family = d.pop("family")

        schema_version = d.pop("schema_version")

        is_emitting = d.pop("is_emitting")

        description = d.pop("description")

        list_webhook_event_types_response_200_data_item = cls(
            type_=type_,
            family=family,
            schema_version=schema_version,
            is_emitting=is_emitting,
            description=description,
        )

        list_webhook_event_types_response_200_data_item.additional_properties = d
        return list_webhook_event_types_response_200_data_item

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
