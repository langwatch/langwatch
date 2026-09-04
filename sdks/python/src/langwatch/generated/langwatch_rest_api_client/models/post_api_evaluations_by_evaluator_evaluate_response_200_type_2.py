from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiEvaluationsByEvaluatorEvaluateResponse200Type2")


@_attrs_define
class PostApiEvaluationsByEvaluatorEvaluateResponse200Type2:
    """
    Attributes:
        status (Literal['error']):
        error_type (Literal['EVALUATOR_ERROR']): Constant: the evaluator's own type is not exposed
        details (str):
        passed (bool | Unset): Always true in guardrail mode, so a failure does not block
    """

    status: Literal["error"]
    error_type: Literal["EVALUATOR_ERROR"]
    details: str
    passed: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        error_type = self.error_type

        details = self.details

        passed = self.passed

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "error_type": error_type,
                "details": details,
            }
        )
        if passed is not UNSET:
            field_dict["passed"] = passed

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = cast(Literal["error"], d.pop("status"))
        if status != "error":
            raise ValueError(f"status must match const 'error', got '{status}'")

        error_type = cast(Literal["EVALUATOR_ERROR"], d.pop("error_type"))
        if error_type != "EVALUATOR_ERROR":
            raise ValueError(f"error_type must match const 'EVALUATOR_ERROR', got '{error_type}'")

        details = d.pop("details")

        passed = d.pop("passed", UNSET)

        post_api_evaluations_by_evaluator_evaluate_response_200_type_2 = cls(
            status=status,
            error_type=error_type,
            details=details,
            passed=passed,
        )

        post_api_evaluations_by_evaluator_evaluate_response_200_type_2.additional_properties = d
        return post_api_evaluations_by_evaluator_evaluate_response_200_type_2

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
