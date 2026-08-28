from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_webhooks_v1_endpoints_response_200_data_item_type_0 import (
        GetApiWebhooksV1EndpointsResponse200DataItemType0,
    )
    from ..models.get_api_webhooks_v1_endpoints_response_200_data_item_type_1 import (
        GetApiWebhooksV1EndpointsResponse200DataItemType1,
    )


T = TypeVar("T", bound="GetApiWebhooksV1EndpointsResponse200")


@_attrs_define
class GetApiWebhooksV1EndpointsResponse200:
    """
    Attributes:
        data (list[GetApiWebhooksV1EndpointsResponse200DataItemType0 |
            GetApiWebhooksV1EndpointsResponse200DataItemType1]):
    """

    data: list[GetApiWebhooksV1EndpointsResponse200DataItemType0 | GetApiWebhooksV1EndpointsResponse200DataItemType1]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_webhooks_v1_endpoints_response_200_data_item_type_0 import (
            GetApiWebhooksV1EndpointsResponse200DataItemType0,
        )

        data = []
        for data_item_data in self.data:
            data_item: dict[str, Any]
            if isinstance(data_item_data, GetApiWebhooksV1EndpointsResponse200DataItemType0):
                data_item = data_item_data.to_dict()
            else:
                data_item = data_item_data.to_dict()

            data.append(data_item)

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
        from ..models.get_api_webhooks_v1_endpoints_response_200_data_item_type_0 import (
            GetApiWebhooksV1EndpointsResponse200DataItemType0,
        )
        from ..models.get_api_webhooks_v1_endpoints_response_200_data_item_type_1 import (
            GetApiWebhooksV1EndpointsResponse200DataItemType1,
        )

        d = dict(src_dict)
        data = []
        _data = d.pop("data")
        for data_item_data in _data:

            def _parse_data_item(
                data: object,
            ) -> GetApiWebhooksV1EndpointsResponse200DataItemType0 | GetApiWebhooksV1EndpointsResponse200DataItemType1:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    data_item_type_0 = GetApiWebhooksV1EndpointsResponse200DataItemType0.from_dict(data)

                    return data_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                data_item_type_1 = GetApiWebhooksV1EndpointsResponse200DataItemType1.from_dict(data)

                return data_item_type_1

            data_item = _parse_data_item(data_item_data)

            data.append(data_item)

        get_api_webhooks_v1_endpoints_response_200 = cls(
            data=data,
        )

        get_api_webhooks_v1_endpoints_response_200.additional_properties = d
        return get_api_webhooks_v1_endpoints_response_200

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
