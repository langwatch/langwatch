from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_virtual_keys_response_201_virtual_key import (
        PostApiGatewayV1VirtualKeysResponse201VirtualKey,
    )


T = TypeVar("T", bound="PostApiGatewayV1VirtualKeysResponse201")


@_attrs_define
class PostApiGatewayV1VirtualKeysResponse201:
    """
    Attributes:
        virtual_key (PostApiGatewayV1VirtualKeysResponse201VirtualKey):
        secret (str | Unset): The secret, absent when `reveal_once` was set.
        reveal_id (str | Unset): With `reveal_once`: the id that serves the secret once, through the app.
        preview (str | Unset): With `reveal_once`: the key's display prefix, safe to show in place of the secret.
    """

    virtual_key: PostApiGatewayV1VirtualKeysResponse201VirtualKey
    secret: str | Unset = UNSET
    reveal_id: str | Unset = UNSET
    preview: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        virtual_key = self.virtual_key.to_dict()

        secret = self.secret

        reveal_id = self.reveal_id

        preview = self.preview

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "virtual_key": virtual_key,
            }
        )
        if secret is not UNSET:
            field_dict["secret"] = secret
        if reveal_id is not UNSET:
            field_dict["reveal_id"] = reveal_id
        if preview is not UNSET:
            field_dict["preview"] = preview

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_virtual_keys_response_201_virtual_key import (
            PostApiGatewayV1VirtualKeysResponse201VirtualKey,
        )

        d = dict(src_dict)
        virtual_key = PostApiGatewayV1VirtualKeysResponse201VirtualKey.from_dict(d.pop("virtual_key"))

        secret = d.pop("secret", UNSET)

        reveal_id = d.pop("reveal_id", UNSET)

        preview = d.pop("preview", UNSET)

        post_api_gateway_v1_virtual_keys_response_201 = cls(
            virtual_key=virtual_key,
            secret=secret,
            reveal_id=reveal_id,
            preview=preview,
        )

        post_api_gateway_v1_virtual_keys_response_201.additional_properties = d
        return post_api_gateway_v1_virtual_keys_response_201

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
