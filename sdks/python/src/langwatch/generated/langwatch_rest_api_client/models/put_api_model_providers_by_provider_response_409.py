from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PutApiModelProvidersByProviderResponse409")


@_attrs_define
class PutApiModelProvidersByProviderResponse409:
    """
    Attributes:
        error (str):
        message (str):
    """

    error: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        message = d.pop("message")

        put_api_model_providers_by_provider_response_409 = cls(
            error=error,
            message=message,
        )

        return put_api_model_providers_by_provider_response_409
