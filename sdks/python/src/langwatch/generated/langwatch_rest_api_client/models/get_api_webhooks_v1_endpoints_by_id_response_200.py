from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_webhooks_v1_endpoints_by_id_response_200_data_type_0 import (
        GetApiWebhooksV1EndpointsByIdResponse200DataType0,
    )
    from ..models.get_api_webhooks_v1_endpoints_by_id_response_200_data_type_1 import (
        GetApiWebhooksV1EndpointsByIdResponse200DataType1,
    )


T = TypeVar("T", bound="GetApiWebhooksV1EndpointsByIdResponse200")


@_attrs_define
class GetApiWebhooksV1EndpointsByIdResponse200:
    """
    Attributes:
        data (GetApiWebhooksV1EndpointsByIdResponse200DataType0 | GetApiWebhooksV1EndpointsByIdResponse200DataType1):
    """

    data: GetApiWebhooksV1EndpointsByIdResponse200DataType0 | GetApiWebhooksV1EndpointsByIdResponse200DataType1

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_webhooks_v1_endpoints_by_id_response_200_data_type_0 import (
            GetApiWebhooksV1EndpointsByIdResponse200DataType0,
        )

        data: dict[str, Any]
        if isinstance(self.data, GetApiWebhooksV1EndpointsByIdResponse200DataType0):
            data = self.data.to_dict()
        else:
            data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_webhooks_v1_endpoints_by_id_response_200_data_type_0 import (
            GetApiWebhooksV1EndpointsByIdResponse200DataType0,
        )
        from ..models.get_api_webhooks_v1_endpoints_by_id_response_200_data_type_1 import (
            GetApiWebhooksV1EndpointsByIdResponse200DataType1,
        )

        d = dict(src_dict)

        def _parse_data(
            data: object,
        ) -> GetApiWebhooksV1EndpointsByIdResponse200DataType0 | GetApiWebhooksV1EndpointsByIdResponse200DataType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                data_type_0 = GetApiWebhooksV1EndpointsByIdResponse200DataType0.from_dict(data)

                return data_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            data_type_1 = GetApiWebhooksV1EndpointsByIdResponse200DataType1.from_dict(data)

            return data_type_1

        data = _parse_data(d.pop("data"))

        get_api_webhooks_v1_endpoints_by_id_response_200 = cls(
            data=data,
        )

        return get_api_webhooks_v1_endpoints_by_id_response_200
