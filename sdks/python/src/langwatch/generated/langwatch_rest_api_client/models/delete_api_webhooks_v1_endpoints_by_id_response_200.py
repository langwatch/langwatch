from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.delete_api_webhooks_v1_endpoints_by_id_response_200_data import (
        DeleteApiWebhooksV1EndpointsByIdResponse200Data,
    )


T = TypeVar("T", bound="DeleteApiWebhooksV1EndpointsByIdResponse200")


@_attrs_define
class DeleteApiWebhooksV1EndpointsByIdResponse200:
    """
    Attributes:
        data (DeleteApiWebhooksV1EndpointsByIdResponse200Data):
    """

    data: DeleteApiWebhooksV1EndpointsByIdResponse200Data

    def to_dict(self) -> dict[str, Any]:
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
        from ..models.delete_api_webhooks_v1_endpoints_by_id_response_200_data import (
            DeleteApiWebhooksV1EndpointsByIdResponse200Data,
        )

        d = dict(src_dict)
        data = DeleteApiWebhooksV1EndpointsByIdResponse200Data.from_dict(d.pop("data"))

        delete_api_webhooks_v1_endpoints_by_id_response_200 = cls(
            data=data,
        )

        return delete_api_webhooks_v1_endpoints_by_id_response_200
