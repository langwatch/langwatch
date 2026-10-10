from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiModelProvidersResponse200AdditionalPropertyExtraHeadersType0Item")


@_attrs_define
class GetApiModelProvidersResponse200AdditionalPropertyExtraHeadersType0Item:
    """
    Attributes:
        key (str):
        value (str):
    """

    key: str
    value: str

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "key": key,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        key = d.pop("key")

        value = d.pop("value")

        get_api_model_providers_response_200_additional_property_extra_headers_type_0_item = cls(
            key=key,
            value=value,
        )

        return get_api_model_providers_response_200_additional_property_extra_headers_type_0_item
