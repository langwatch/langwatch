from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_virtual_keys_by_id_response_200_virtual_key import (
        GetApiGatewayV1VirtualKeysByIdResponse200VirtualKey,
    )


T = TypeVar("T", bound="GetApiGatewayV1VirtualKeysByIdResponse200")


@_attrs_define
class GetApiGatewayV1VirtualKeysByIdResponse200:
    """
    Attributes:
        virtual_key (GetApiGatewayV1VirtualKeysByIdResponse200VirtualKey):
    """

    virtual_key: GetApiGatewayV1VirtualKeysByIdResponse200VirtualKey
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        virtual_key = self.virtual_key.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "virtual_key": virtual_key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_virtual_keys_by_id_response_200_virtual_key import (
            GetApiGatewayV1VirtualKeysByIdResponse200VirtualKey,
        )

        d = dict(src_dict)
        virtual_key = GetApiGatewayV1VirtualKeysByIdResponse200VirtualKey.from_dict(d.pop("virtual_key"))

        get_api_gateway_v1_virtual_keys_by_id_response_200 = cls(
            virtual_key=virtual_key,
        )

        get_api_gateway_v1_virtual_keys_by_id_response_200.additional_properties = d
        return get_api_gateway_v1_virtual_keys_by_id_response_200

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
