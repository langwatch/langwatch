from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200_data_type_0 import (
        PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType0,
    )
    from ..models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200_data_type_1 import (
        PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType1,
    )


T = TypeVar("T", bound="PostApiWebhooksV1EndpointsByIdRollSecretResponse200")


@_attrs_define
class PostApiWebhooksV1EndpointsByIdRollSecretResponse200:
    """
    Attributes:
        data (PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType0 |
            PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType1):
    """

    data: (
        PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType0
        | PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType1
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200_data_type_0 import (
            PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType0,
        )

        data: dict[str, Any]
        if isinstance(self.data, PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType0):
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
        from ..models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200_data_type_0 import (
            PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType0,
        )
        from ..models.post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200_data_type_1 import (
            PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType1,
        )

        d = dict(src_dict)

        def _parse_data(
            data: object,
        ) -> (
            PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType0
            | PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType1
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                data_type_0 = PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType0.from_dict(data)

                return data_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            data_type_1 = PostApiWebhooksV1EndpointsByIdRollSecretResponse200DataType1.from_dict(data)

            return data_type_1

        data = _parse_data(d.pop("data"))

        post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200 = cls(
            data=data,
        )

        return post_api_webhooks_v1_endpoints_by_id_roll_secret_response_200
