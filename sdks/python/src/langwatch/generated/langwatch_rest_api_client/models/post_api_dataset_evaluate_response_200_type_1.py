from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_dataset_evaluate_response_200_type_1_cost import PostApiDatasetEvaluateResponse200Type1Cost


T = TypeVar("T", bound="PostApiDatasetEvaluateResponse200Type1")


@_attrs_define
class PostApiDatasetEvaluateResponse200Type1:
    """
    Attributes:
        status (Literal['skipped']):
        details (str | Unset): Why the evaluator declined to score this input
        cost (PostApiDatasetEvaluateResponse200Type1Cost | Unset): What the attempt cost, when the evaluator spent money
            before declining to score
        passed (bool | Unset): Always true in guardrail mode, so a skip does not block
    """

    status: Literal["skipped"]
    details: str | Unset = UNSET
    cost: PostApiDatasetEvaluateResponse200Type1Cost | Unset = UNSET
    passed: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        details = self.details

        cost: dict[str, Any] | Unset = UNSET
        if not isinstance(self.cost, Unset):
            cost = self.cost.to_dict()

        passed = self.passed

        field_dict: dict[str, Any] = {}

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
        from ..models.post_api_dataset_evaluate_response_200_type_1_cost import (
            PostApiDatasetEvaluateResponse200Type1Cost,
        )

        d = dict(src_dict)
        status = cast(Literal["skipped"], d.pop("status"))
        if status != "skipped":
            raise ValueError(f"status must match const 'skipped', got '{status}'")

        details = d.pop("details", UNSET)

        _cost = d.pop("cost", UNSET)
        cost: PostApiDatasetEvaluateResponse200Type1Cost | Unset
        if isinstance(_cost, Unset):
            cost = UNSET
        else:
            cost = PostApiDatasetEvaluateResponse200Type1Cost.from_dict(_cost)

        passed = d.pop("passed", UNSET)

        post_api_dataset_evaluate_response_200_type_1 = cls(
            status=status,
            details=details,
            cost=cost,
            passed=passed,
        )

        return post_api_dataset_evaluate_response_200_type_1
