from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluations_by_evaluator_by_subpath_evaluate_response_200_type_0_cost import (
        PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0Cost,
    )


T = TypeVar("T", bound="PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0")


@_attrs_define
class PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0:
    """
    Attributes:
        status (Literal['processed']):
        score (float | Unset):
        passed (bool | Unset):
        label (str | Unset):
        details (str | Unset):
        cost (PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0Cost | Unset): What running the evaluator
            cost
        raw_response (Any | Unset): The evaluator's own output, unprocessed
    """

    status: Literal["processed"]
    score: float | Unset = UNSET
    passed: bool | Unset = UNSET
    label: str | Unset = UNSET
    details: str | Unset = UNSET
    cost: PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0Cost | Unset = UNSET
    raw_response: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        score = self.score

        passed = self.passed

        label = self.label

        details = self.details

        cost: dict[str, Any] | Unset = UNSET
        if not isinstance(self.cost, Unset):
            cost = self.cost.to_dict()

        raw_response = self.raw_response

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
            }
        )
        if score is not UNSET:
            field_dict["score"] = score
        if passed is not UNSET:
            field_dict["passed"] = passed
        if label is not UNSET:
            field_dict["label"] = label
        if details is not UNSET:
            field_dict["details"] = details
        if cost is not UNSET:
            field_dict["cost"] = cost
        if raw_response is not UNSET:
            field_dict["raw_response"] = raw_response

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_evaluations_by_evaluator_by_subpath_evaluate_response_200_type_0_cost import (
            PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0Cost,
        )

        d = dict(src_dict)
        status = cast(Literal["processed"], d.pop("status"))
        if status != "processed":
            raise ValueError(f"status must match const 'processed', got '{status}'")

        score = d.pop("score", UNSET)

        passed = d.pop("passed", UNSET)

        label = d.pop("label", UNSET)

        details = d.pop("details", UNSET)

        _cost = d.pop("cost", UNSET)
        cost: PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0Cost | Unset
        if isinstance(_cost, Unset):
            cost = UNSET
        else:
            cost = PostApiEvaluationsByEvaluatorBySubpathEvaluateResponse200Type0Cost.from_dict(_cost)

        raw_response = d.pop("raw_response", UNSET)

        post_api_evaluations_by_evaluator_by_subpath_evaluate_response_200_type_0 = cls(
            status=status,
            score=score,
            passed=passed,
            label=label,
            details=details,
            cost=cost,
            raw_response=raw_response,
        )

        post_api_evaluations_by_evaluator_by_subpath_evaluate_response_200_type_0.additional_properties = d
        return post_api_evaluations_by_evaluator_by_subpath_evaluate_response_200_type_0

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
