from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ConfirmOneClickUnsubscribeResponse200")


@_attrs_define
class ConfirmOneClickUnsubscribeResponse200:
    """
    Attributes:
        ok (bool):
    """

    ok: bool

    def to_dict(self) -> dict[str, Any]:
        ok = self.ok

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ok": ok,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ok = d.pop("ok")

        confirm_one_click_unsubscribe_response_200 = cls(
            ok=ok,
        )

        return confirm_one_click_unsubscribe_response_200
