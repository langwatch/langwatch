from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ApplySuiteTemplateResponse404")


@_attrs_define
class ApplySuiteTemplateResponse404:
    """
    Attributes:
        error (str):
        code (str):
        message (str | Unset):
    """

    error: str
    code: str
    message: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        code = self.code

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
                "code": code,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        code = d.pop("code")

        message = d.pop("message", UNSET)

        apply_suite_template_response_404 = cls(
            error=error,
            code=code,
            message=message,
        )

        return apply_suite_template_response_404
