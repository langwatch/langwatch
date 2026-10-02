from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiGatewayV1VirtualKeysByIdSpendResponse200Window")


@_attrs_define
class GetApiGatewayV1VirtualKeysByIdSpendResponse200Window:
    """
    Attributes:
        from_ (int):
        to (int):
    """

    from_: int
    to: int

    def to_dict(self) -> dict[str, Any]:
        from_ = self.from_

        to = self.to

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "from": from_,
                "to": to,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        from_ = d.pop("from")

        to = d.pop("to")

        get_api_gateway_v1_virtual_keys_by_id_spend_response_200_window = cls(
            from_=from_,
            to=to,
        )

        return get_api_gateway_v1_virtual_keys_by_id_spend_response_200_window
