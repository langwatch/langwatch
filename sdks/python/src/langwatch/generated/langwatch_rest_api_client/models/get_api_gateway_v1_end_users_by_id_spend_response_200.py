from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data import (
        GetApiGatewayV1EndUsersByIdSpendResponse200Data,
    )


T = TypeVar("T", bound="GetApiGatewayV1EndUsersByIdSpendResponse200")


@_attrs_define
class GetApiGatewayV1EndUsersByIdSpendResponse200:
    """
    Attributes:
        data (GetApiGatewayV1EndUsersByIdSpendResponse200Data):
    """

    data: GetApiGatewayV1EndUsersByIdSpendResponse200Data

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
        from ..models.get_api_gateway_v1_end_users_by_id_spend_response_200_data import (
            GetApiGatewayV1EndUsersByIdSpendResponse200Data,
        )

        d = dict(src_dict)
        data = GetApiGatewayV1EndUsersByIdSpendResponse200Data.from_dict(d.pop("data"))

        get_api_gateway_v1_end_users_by_id_spend_response_200 = cls(
            data=data,
        )

        return get_api_gateway_v1_end_users_by_id_spend_response_200
