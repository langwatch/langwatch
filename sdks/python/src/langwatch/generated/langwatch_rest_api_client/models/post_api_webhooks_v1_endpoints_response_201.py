from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_webhooks_v1_endpoints_response_201_data_type_0 import (
        PostApiWebhooksV1EndpointsResponse201DataType0,
    )
    from ..models.post_api_webhooks_v1_endpoints_response_201_data_type_1 import (
        PostApiWebhooksV1EndpointsResponse201DataType1,
    )


T = TypeVar("T", bound="PostApiWebhooksV1EndpointsResponse201")


@_attrs_define
class PostApiWebhooksV1EndpointsResponse201:
    """
    Attributes:
        data (PostApiWebhooksV1EndpointsResponse201DataType0 | PostApiWebhooksV1EndpointsResponse201DataType1):
    """

    data: PostApiWebhooksV1EndpointsResponse201DataType0 | PostApiWebhooksV1EndpointsResponse201DataType1
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_webhooks_v1_endpoints_response_201_data_type_0 import (
            PostApiWebhooksV1EndpointsResponse201DataType0,
        )

        data: dict[str, Any]
        if isinstance(self.data, PostApiWebhooksV1EndpointsResponse201DataType0):
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
        from ..models.post_api_webhooks_v1_endpoints_response_201_data_type_0 import (
            PostApiWebhooksV1EndpointsResponse201DataType0,
        )
        from ..models.post_api_webhooks_v1_endpoints_response_201_data_type_1 import (
            PostApiWebhooksV1EndpointsResponse201DataType1,
        )

        d = dict(src_dict)

        def _parse_data(
            data: object,
        ) -> PostApiWebhooksV1EndpointsResponse201DataType0 | PostApiWebhooksV1EndpointsResponse201DataType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                data_type_0 = PostApiWebhooksV1EndpointsResponse201DataType0.from_dict(data)

                return data_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            data_type_1 = PostApiWebhooksV1EndpointsResponse201DataType1.from_dict(data)

            return data_type_1

        data = _parse_data(d.pop("data"))

        post_api_webhooks_v1_endpoints_response_201 = cls(
            data=data,
        )

        post_api_webhooks_v1_endpoints_response_201.additional_properties = d
        return post_api_webhooks_v1_endpoints_response_201

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
