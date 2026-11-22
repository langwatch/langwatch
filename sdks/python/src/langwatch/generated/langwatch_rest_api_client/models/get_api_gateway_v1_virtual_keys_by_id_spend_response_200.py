from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_gateway_v1_virtual_keys_by_id_spend_response_200_window import (
        GetApiGatewayV1VirtualKeysByIdSpendResponse200Window,
    )


T = TypeVar("T", bound="GetApiGatewayV1VirtualKeysByIdSpendResponse200")


@_attrs_define
class GetApiGatewayV1VirtualKeysByIdSpendResponse200:
    """
    Attributes:
        virtual_key_id (str):
        spent_usd (str):
        requests (int):
        window (GetApiGatewayV1VirtualKeysByIdSpendResponse200Window):
    """

    virtual_key_id: str
    spent_usd: str
    requests: int
    window: GetApiGatewayV1VirtualKeysByIdSpendResponse200Window

    def to_dict(self) -> dict[str, Any]:
        virtual_key_id = self.virtual_key_id

        spent_usd = self.spent_usd

        requests = self.requests

        window = self.window.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "virtual_key_id": virtual_key_id,
                "spent_usd": spent_usd,
                "requests": requests,
                "window": window,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_gateway_v1_virtual_keys_by_id_spend_response_200_window import (
            GetApiGatewayV1VirtualKeysByIdSpendResponse200Window,
        )

        d = dict(src_dict)
        virtual_key_id = d.pop("virtual_key_id")

        spent_usd = d.pop("spent_usd")

        requests = d.pop("requests")

        window = GetApiGatewayV1VirtualKeysByIdSpendResponse200Window.from_dict(d.pop("window"))

        get_api_gateway_v1_virtual_keys_by_id_spend_response_200 = cls(
            virtual_key_id=virtual_key_id,
            spent_usd=spent_usd,
            requests=requests,
            window=window,
        )

        return get_api_gateway_v1_virtual_keys_by_id_spend_response_200
