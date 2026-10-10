from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CancelLangyControlRequestResponse200")


@_attrs_define
class CancelLangyControlRequestResponse200:
    """
    Attributes:
        id (str): The request that was cancelled.
        cancelled (bool): Always true once the request is gone.
    """

    id: str
    cancelled: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        cancelled = self.cancelled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "cancelled": cancelled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        cancelled = d.pop("cancelled")

        cancel_langy_control_request_response_200 = cls(
            id=id,
            cancelled=cancelled,
        )

        return cancel_langy_control_request_response_200
