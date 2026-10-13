from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.create_full_access_api_key_response_201_api_key import CreateFullAccessApiKeyResponse201ApiKey


T = TypeVar("T", bound="CreateFullAccessApiKeyResponse201")


@_attrs_define
class CreateFullAccessApiKeyResponse201:
    """
    Attributes:
        token (str):
        api_key (CreateFullAccessApiKeyResponse201ApiKey):
    """

    token: str
    api_key: CreateFullAccessApiKeyResponse201ApiKey

    def to_dict(self) -> dict[str, Any]:
        token = self.token

        api_key = self.api_key.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "token": token,
                "apiKey": api_key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_full_access_api_key_response_201_api_key import CreateFullAccessApiKeyResponse201ApiKey

        d = dict(src_dict)
        token = d.pop("token")

        api_key = CreateFullAccessApiKeyResponse201ApiKey.from_dict(d.pop("apiKey"))

        create_full_access_api_key_response_201 = cls(
            token=token,
            api_key=api_key,
        )

        return create_full_access_api_key_response_201
