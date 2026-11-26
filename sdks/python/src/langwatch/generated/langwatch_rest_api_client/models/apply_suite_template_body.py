from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.apply_suite_template_body_fit import ApplySuiteTemplateBodyFit


T = TypeVar("T", bound="ApplySuiteTemplateBody")


@_attrs_define
class ApplySuiteTemplateBody:
    """
    Attributes:
        fit (ApplySuiteTemplateBodyFit):
        name (str | Unset):
    """

    fit: ApplySuiteTemplateBodyFit
    name: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        fit = self.fit.to_dict()

        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "fit": fit,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.apply_suite_template_body_fit import ApplySuiteTemplateBodyFit

        d = dict(src_dict)
        fit = ApplySuiteTemplateBodyFit.from_dict(d.pop("fit"))

        name = d.pop("name", UNSET)

        apply_suite_template_body = cls(
            fit=fit,
            name=name,
        )

        return apply_suite_template_body
