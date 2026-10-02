from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiCheckupResponse200RowsItemVerdictType2")


@_attrs_define
class GetApiCheckupResponse200RowsItemVerdictType2:
    """
    Attributes:
        outcome (Literal['unchecked']):
        detail (str | Unset):
        fix (str | Unset):
        docs_path (str | Unset):
    """

    outcome: Literal["unchecked"]
    detail: str | Unset = UNSET
    fix: str | Unset = UNSET
    docs_path: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        outcome = self.outcome

        detail = self.detail

        fix = self.fix

        docs_path = self.docs_path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "outcome": outcome,
            }
        )
        if detail is not UNSET:
            field_dict["detail"] = detail
        if fix is not UNSET:
            field_dict["fix"] = fix
        if docs_path is not UNSET:
            field_dict["docsPath"] = docs_path

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        outcome = cast(Literal["unchecked"], d.pop("outcome"))
        if outcome != "unchecked":
            raise ValueError(f"outcome must match const 'unchecked', got '{outcome}'")

        detail = d.pop("detail", UNSET)

        fix = d.pop("fix", UNSET)

        docs_path = d.pop("docsPath", UNSET)

        get_api_checkup_response_200_rows_item_verdict_type_2 = cls(
            outcome=outcome,
            detail=detail,
            fix=fix,
            docs_path=docs_path,
        )

        return get_api_checkup_response_200_rows_item_verdict_type_2
