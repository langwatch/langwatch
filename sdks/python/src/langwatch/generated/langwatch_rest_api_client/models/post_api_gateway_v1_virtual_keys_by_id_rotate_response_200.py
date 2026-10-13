from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_gateway_v1_virtual_keys_by_id_rotate_response_200_virtual_key import (
        PostApiGatewayV1VirtualKeysByIdRotateResponse200VirtualKey,
    )


T = TypeVar("T", bound="PostApiGatewayV1VirtualKeysByIdRotateResponse200")


@_attrs_define
class PostApiGatewayV1VirtualKeysByIdRotateResponse200:
    """
    Attributes:
        virtual_key (PostApiGatewayV1VirtualKeysByIdRotateResponse200VirtualKey):
        secret (str):
    """

    virtual_key: PostApiGatewayV1VirtualKeysByIdRotateResponse200VirtualKey
    secret: str

    def to_dict(self) -> dict[str, Any]:
        virtual_key = self.virtual_key.to_dict()

        secret = self.secret

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "virtual_key": virtual_key,
                "secret": secret,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_gateway_v1_virtual_keys_by_id_rotate_response_200_virtual_key import (
            PostApiGatewayV1VirtualKeysByIdRotateResponse200VirtualKey,
        )

        d = dict(src_dict)
        virtual_key = PostApiGatewayV1VirtualKeysByIdRotateResponse200VirtualKey.from_dict(d.pop("virtual_key"))

        secret = d.pop("secret")

        post_api_gateway_v1_virtual_keys_by_id_rotate_response_200 = cls(
            virtual_key=virtual_key,
            secret=secret,
        )

        return post_api_gateway_v1_virtual_keys_by_id_rotate_response_200
