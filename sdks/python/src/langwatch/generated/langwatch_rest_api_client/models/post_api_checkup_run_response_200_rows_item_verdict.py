from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_checkup_run_response_200_rows_item_verdict_outcome import (
    PostApiCheckupRunResponse200RowsItemVerdictOutcome,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiCheckupRunResponse200RowsItemVerdict")


@_attrs_define
class PostApiCheckupRunResponse200RowsItemVerdict:
    """
    Attributes:
        outcome (PostApiCheckupRunResponse200RowsItemVerdictOutcome):
        detail (str):
        code (str | Unset): Present on a refused verdict: the stable error code.
        fix (str | Unset):
        docs_path (str | Unset):
    """

    outcome: PostApiCheckupRunResponse200RowsItemVerdictOutcome
    detail: str
    code: str | Unset = UNSET
    fix: str | Unset = UNSET
    docs_path: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        outcome = self.outcome.value

        detail = self.detail

        code = self.code

        fix = self.fix

        docs_path = self.docs_path

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "outcome": outcome,
                "detail": detail,
            }
        )
        if code is not UNSET:
            field_dict["code"] = code
        if fix is not UNSET:
            field_dict["fix"] = fix
        if docs_path is not UNSET:
            field_dict["docsPath"] = docs_path

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        outcome = PostApiCheckupRunResponse200RowsItemVerdictOutcome(d.pop("outcome"))

        detail = d.pop("detail")

        code = d.pop("code", UNSET)

        fix = d.pop("fix", UNSET)

        docs_path = d.pop("docsPath", UNSET)

        post_api_checkup_run_response_200_rows_item_verdict = cls(
            outcome=outcome,
            detail=detail,
            code=code,
            fix=fix,
            docs_path=docs_path,
        )

        post_api_checkup_run_response_200_rows_item_verdict.additional_properties = d
        return post_api_checkup_run_response_200_rows_item_verdict

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
