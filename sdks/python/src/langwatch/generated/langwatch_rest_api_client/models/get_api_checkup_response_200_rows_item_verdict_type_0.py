from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiCheckupResponse200RowsItemVerdictType0")


@_attrs_define
class GetApiCheckupResponse200RowsItemVerdictType0:
    """
    Attributes:
        outcome (Literal['verified']):
        detail (str | Unset):
    """

    outcome: Literal["verified"]
    detail: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        outcome = self.outcome

        detail = self.detail

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "outcome": outcome,
            }
        )
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        outcome = cast(Literal["verified"], d.pop("outcome"))
        if outcome != "verified":
            raise ValueError(f"outcome must match const 'verified', got '{outcome}'")

        detail = d.pop("detail", UNSET)

        get_api_checkup_response_200_rows_item_verdict_type_0 = cls(
            outcome=outcome,
            detail=detail,
        )

        return get_api_checkup_response_200_rows_item_verdict_type_0
