from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.get_stored_object_response_200_capability_audience import GetStoredObjectResponse200CapabilityAudience
from ..models.get_stored_object_response_200_capability_methods_item import (
    GetStoredObjectResponse200CapabilityMethodsItem,
)

T = TypeVar("T", bound="GetStoredObjectResponse200Capability")


@_attrs_define
class GetStoredObjectResponse200Capability:
    """
    Attributes:
        url (str):
        expires_at (datetime.datetime):
        methods (list[GetStoredObjectResponse200CapabilityMethodsItem]):
        audience (GetStoredObjectResponse200CapabilityAudience):
        generation (int):
    """

    url: str
    expires_at: datetime.datetime
    methods: list[GetStoredObjectResponse200CapabilityMethodsItem]
    audience: GetStoredObjectResponse200CapabilityAudience
    generation: int

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        expires_at = self.expires_at.isoformat()

        methods = []
        for methods_item_data in self.methods:
            methods_item = methods_item_data.value
            methods.append(methods_item)

        audience = self.audience.value

        generation = self.generation

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "url": url,
                "expiresAt": expires_at,
                "methods": methods,
                "audience": audience,
                "generation": generation,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url")

        expires_at = isoparse(d.pop("expiresAt"))

        methods = []
        _methods = d.pop("methods")
        for methods_item_data in _methods:
            methods_item = GetStoredObjectResponse200CapabilityMethodsItem(methods_item_data)

            methods.append(methods_item)

        audience = GetStoredObjectResponse200CapabilityAudience(d.pop("audience"))

        generation = d.pop("generation")

        get_stored_object_response_200_capability = cls(
            url=url,
            expires_at=expires_at,
            methods=methods,
            audience=audience,
            generation=generation,
        )

        return get_stored_object_response_200_capability
