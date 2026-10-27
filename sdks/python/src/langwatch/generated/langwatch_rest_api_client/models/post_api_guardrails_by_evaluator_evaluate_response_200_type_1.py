from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_guardrails_by_evaluator_evaluate_response_200_type_1_cost import (
        PostApiGuardrailsByEvaluatorEvaluateResponse200Type1Cost,
    )


T = TypeVar("T", bound="PostApiGuardrailsByEvaluatorEvaluateResponse200Type1")


@_attrs_define
class PostApiGuardrailsByEvaluatorEvaluateResponse200Type1:
    """
    Attributes:
        status (Literal['skipped']):
        details (str | Unset): Why the evaluator declined to score this input
        cost (PostApiGuardrailsByEvaluatorEvaluateResponse200Type1Cost | Unset): What the attempt cost, when the
            evaluator spent money before declining to score
        passed (bool | Unset): Always true in guardrail mode, so a skip does not block
    """

    status: Literal["skipped"]
    details: str | Unset = UNSET
    cost: PostApiGuardrailsByEvaluatorEvaluateResponse200Type1Cost | Unset = UNSET
    passed: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        details = self.details

        cost: dict[str, Any] | Unset = UNSET
        if not isinstance(self.cost, Unset):
            cost = self.cost.to_dict()

        passed = self.passed

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details
        if cost is not UNSET:
            field_dict["cost"] = cost
        if passed is not UNSET:
            field_dict["passed"] = passed

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_guardrails_by_evaluator_evaluate_response_200_type_1_cost import (
            PostApiGuardrailsByEvaluatorEvaluateResponse200Type1Cost,
        )

        d = dict(src_dict)
        status = cast(Literal["skipped"], d.pop("status"))
        if status != "skipped":
            raise ValueError(f"status must match const 'skipped', got '{status}'")

        details = d.pop("details", UNSET)

        _cost = d.pop("cost", UNSET)
        cost: PostApiGuardrailsByEvaluatorEvaluateResponse200Type1Cost | Unset
        if isinstance(_cost, Unset):
            cost = UNSET
        else:
            cost = PostApiGuardrailsByEvaluatorEvaluateResponse200Type1Cost.from_dict(_cost)

        passed = d.pop("passed", UNSET)

        post_api_guardrails_by_evaluator_evaluate_response_200_type_1 = cls(
            status=status,
            details=details,
            cost=cost,
            passed=passed,
        )

        post_api_guardrails_by_evaluator_evaluate_response_200_type_1.additional_properties = d
        return post_api_guardrails_by_evaluator_evaluate_response_200_type_1

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
