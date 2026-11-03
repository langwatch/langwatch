from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RedeemStaffAccessRequestBody")


@_attrs_define
class RedeemStaffAccessRequestBody:
    """
    Attributes:
        code_verifier (str):
    """

    code_verifier: str

    def to_dict(self) -> dict[str, Any]:
        code_verifier = self.code_verifier

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "codeVerifier": code_verifier,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        code_verifier = d.pop("codeVerifier")

        redeem_staff_access_request_body = cls(
            code_verifier=code_verifier,
        )

        return redeem_staff_access_request_body
