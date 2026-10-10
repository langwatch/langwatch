from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_checkup_response_200_rows_item_verdict_type_1_meta import (
        GetApiCheckupResponse200RowsItemVerdictType1Meta,
    )


T = TypeVar("T", bound="GetApiCheckupResponse200RowsItemVerdictType1")


@_attrs_define
class GetApiCheckupResponse200RowsItemVerdictType1:
    """
    Attributes:
        outcome (Literal['refused']):
        code (str | Unset):
        detail (str | Unset):
        fix (str | Unset):
        docs_path (str | Unset):
        meta (GetApiCheckupResponse200RowsItemVerdictType1Meta | Unset):
    """

    outcome: Literal["refused"]
    code: str | Unset = UNSET
    detail: str | Unset = UNSET
    fix: str | Unset = UNSET
    docs_path: str | Unset = UNSET
    meta: GetApiCheckupResponse200RowsItemVerdictType1Meta | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        outcome = self.outcome

        code = self.code

        detail = self.detail

        fix = self.fix

        docs_path = self.docs_path

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "outcome": outcome,
            }
        )
        if code is not UNSET:
            field_dict["code"] = code
        if detail is not UNSET:
            field_dict["detail"] = detail
        if fix is not UNSET:
            field_dict["fix"] = fix
        if docs_path is not UNSET:
            field_dict["docsPath"] = docs_path
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_checkup_response_200_rows_item_verdict_type_1_meta import (
            GetApiCheckupResponse200RowsItemVerdictType1Meta,
        )

        d = dict(src_dict)
        outcome = cast(Literal["refused"], d.pop("outcome"))
        if outcome != "refused":
            raise ValueError(f"outcome must match const 'refused', got '{outcome}'")

        code = d.pop("code", UNSET)

        detail = d.pop("detail", UNSET)

        fix = d.pop("fix", UNSET)

        docs_path = d.pop("docsPath", UNSET)

        _meta = d.pop("meta", UNSET)
        meta: GetApiCheckupResponse200RowsItemVerdictType1Meta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = GetApiCheckupResponse200RowsItemVerdictType1Meta.from_dict(_meta)

        get_api_checkup_response_200_rows_item_verdict_type_1 = cls(
            outcome=outcome,
            code=code,
            detail=detail,
            fix=fix,
            docs_path=docs_path,
            meta=meta,
        )

        return get_api_checkup_response_200_rows_item_verdict_type_1
