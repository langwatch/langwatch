from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiWebhooksV1EventTypesResponse200DataItem")


@_attrs_define
class GetApiWebhooksV1EventTypesResponse200DataItem:
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

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        family = self.family

        schema_version = self.schema_version

        is_emitting = self.is_emitting

        description = self.description

        field_dict: dict[str, Any] = {}

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

        get_api_webhooks_v1_event_types_response_200_data_item = cls(
            type_=type_,
            family=family,
            schema_version=schema_version,
            is_emitting=is_emitting,
            description=description,
        )

        return get_api_webhooks_v1_event_types_response_200_data_item
