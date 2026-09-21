from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.patch_api_webhooks_v1_endpoints_by_id_response_200_data_type_0 import (
        PatchApiWebhooksV1EndpointsByIdResponse200DataType0,
    )
    from ..models.patch_api_webhooks_v1_endpoints_by_id_response_200_data_type_1 import (
        PatchApiWebhooksV1EndpointsByIdResponse200DataType1,
    )


T = TypeVar("T", bound="PatchApiWebhooksV1EndpointsByIdResponse200")


@_attrs_define
class PatchApiWebhooksV1EndpointsByIdResponse200:
    """
    Attributes:
        data (PatchApiWebhooksV1EndpointsByIdResponse200DataType0 |
            PatchApiWebhooksV1EndpointsByIdResponse200DataType1):
    """

    data: PatchApiWebhooksV1EndpointsByIdResponse200DataType0 | PatchApiWebhooksV1EndpointsByIdResponse200DataType1
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_webhooks_v1_endpoints_by_id_response_200_data_type_0 import (
            PatchApiWebhooksV1EndpointsByIdResponse200DataType0,
        )

        data: dict[str, Any]
        if isinstance(self.data, PatchApiWebhooksV1EndpointsByIdResponse200DataType0):
            data = self.data.to_dict()
        else:
            data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_webhooks_v1_endpoints_by_id_response_200_data_type_0 import (
            PatchApiWebhooksV1EndpointsByIdResponse200DataType0,
        )
        from ..models.patch_api_webhooks_v1_endpoints_by_id_response_200_data_type_1 import (
            PatchApiWebhooksV1EndpointsByIdResponse200DataType1,
        )

        d = dict(src_dict)

        def _parse_data(
            data: object,
        ) -> PatchApiWebhooksV1EndpointsByIdResponse200DataType0 | PatchApiWebhooksV1EndpointsByIdResponse200DataType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                data_type_0 = PatchApiWebhooksV1EndpointsByIdResponse200DataType0.from_dict(data)

                return data_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            data_type_1 = PatchApiWebhooksV1EndpointsByIdResponse200DataType1.from_dict(data)

            return data_type_1

        data = _parse_data(d.pop("data"))

        patch_api_webhooks_v1_endpoints_by_id_response_200 = cls(
            data=data,
        )

        patch_api_webhooks_v1_endpoints_by_id_response_200.additional_properties = d
        return patch_api_webhooks_v1_endpoints_by_id_response_200

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
