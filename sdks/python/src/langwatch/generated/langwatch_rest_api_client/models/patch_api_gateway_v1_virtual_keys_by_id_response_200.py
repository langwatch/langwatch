from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.patch_api_gateway_v1_virtual_keys_by_id_response_200_virtual_key import (
        PatchApiGatewayV1VirtualKeysByIdResponse200VirtualKey,
    )


T = TypeVar("T", bound="PatchApiGatewayV1VirtualKeysByIdResponse200")


@_attrs_define
class PatchApiGatewayV1VirtualKeysByIdResponse200:
    """
    Attributes:
        virtual_key (PatchApiGatewayV1VirtualKeysByIdResponse200VirtualKey):
    """

    virtual_key: PatchApiGatewayV1VirtualKeysByIdResponse200VirtualKey

    def to_dict(self) -> dict[str, Any]:
        virtual_key = self.virtual_key.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "virtual_key": virtual_key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_gateway_v1_virtual_keys_by_id_response_200_virtual_key import (
            PatchApiGatewayV1VirtualKeysByIdResponse200VirtualKey,
        )

        d = dict(src_dict)
        virtual_key = PatchApiGatewayV1VirtualKeysByIdResponse200VirtualKey.from_dict(d.pop("virtual_key"))

        patch_api_gateway_v1_virtual_keys_by_id_response_200 = cls(
            virtual_key=virtual_key,
        )

        return patch_api_gateway_v1_virtual_keys_by_id_response_200
