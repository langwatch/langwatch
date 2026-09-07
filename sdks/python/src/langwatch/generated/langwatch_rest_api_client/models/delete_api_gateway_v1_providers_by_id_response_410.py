from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.delete_api_gateway_v1_providers_by_id_response_410_error import (
        DeleteApiGatewayV1ProvidersByIdResponse410Error,
    )


T = TypeVar("T", bound="DeleteApiGatewayV1ProvidersByIdResponse410")


@_attrs_define
class DeleteApiGatewayV1ProvidersByIdResponse410:
    """
    Attributes:
        error (DeleteApiGatewayV1ProvidersByIdResponse410Error):
    """

    error: DeleteApiGatewayV1ProvidersByIdResponse410Error
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.delete_api_gateway_v1_providers_by_id_response_410_error import (
            DeleteApiGatewayV1ProvidersByIdResponse410Error,
        )

        d = dict(src_dict)
        error = DeleteApiGatewayV1ProvidersByIdResponse410Error.from_dict(d.pop("error"))

        delete_api_gateway_v1_providers_by_id_response_410 = cls(
            error=error,
        )

        delete_api_gateway_v1_providers_by_id_response_410.additional_properties = d
        return delete_api_gateway_v1_providers_by_id_response_410

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
