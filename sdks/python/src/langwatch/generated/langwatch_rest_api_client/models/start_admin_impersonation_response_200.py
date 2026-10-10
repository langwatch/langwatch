from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="StartAdminImpersonationResponse200")


@_attrs_define
class StartAdminImpersonationResponse200:
    """
    Attributes:
        message (Literal['Impersonation started']):
    """

    message: Literal["Impersonation started"]

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = cast(Literal["Impersonation started"], d.pop("message"))
        if message != "Impersonation started":
            raise ValueError(f"message must match const 'Impersonation started', got '{message}'")

        start_admin_impersonation_response_200 = cls(
            message=message,
        )

        return start_admin_impersonation_response_200
