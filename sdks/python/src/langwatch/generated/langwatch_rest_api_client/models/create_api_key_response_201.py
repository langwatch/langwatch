from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_api_key_response_201_api_key import CreateApiKeyResponse201ApiKey


T = TypeVar("T", bound="CreateApiKeyResponse201")


@_attrs_define
class CreateApiKeyResponse201:
    """
    Attributes:
        token (str | Unset): Plaintext API key token (sk-lw-...). Store securely — shown only once.
        api_key (CreateApiKeyResponse201ApiKey | Unset):
    """

    token: str | Unset = UNSET
    api_key: CreateApiKeyResponse201ApiKey | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        token = self.token

        api_key: dict[str, Any] | Unset = UNSET
        if not isinstance(self.api_key, Unset):
            api_key = self.api_key.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if token is not UNSET:
            field_dict["token"] = token
        if api_key is not UNSET:
            field_dict["apiKey"] = api_key

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_api_key_response_201_api_key import CreateApiKeyResponse201ApiKey

        d = dict(src_dict)
        token = d.pop("token", UNSET)

        _api_key = d.pop("apiKey", UNSET)
        api_key: CreateApiKeyResponse201ApiKey | Unset
        if isinstance(_api_key, Unset):
            api_key = UNSET
        else:
            api_key = CreateApiKeyResponse201ApiKey.from_dict(_api_key)

        create_api_key_response_201 = cls(
            token=token,
            api_key=api_key,
        )

        create_api_key_response_201.additional_properties = d
        return create_api_key_response_201

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
