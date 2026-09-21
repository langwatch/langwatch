from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResponse200SummaryEvaluatorsItem")


@_attrs_define
class GetApiExperimentsRunsByRunIdResponse200SummaryEvaluatorsItem:
    """
    Attributes:
        evaluator_id (str):
        name (str):
        passed (float):
        failed (float):
        pass_rate (float):
        avg_score (float | Unset):
    """

    evaluator_id: str
    name: str
    passed: float
    failed: float
    pass_rate: float
    avg_score: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        evaluator_id = self.evaluator_id

        name = self.name

        passed = self.passed

        failed = self.failed

        pass_rate = self.pass_rate

        avg_score = self.avg_score

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "evaluatorId": evaluator_id,
                "name": name,
                "passed": passed,
                "failed": failed,
                "passRate": pass_rate,
            }
        )
        if avg_score is not UNSET:
            field_dict["avgScore"] = avg_score

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        evaluator_id = d.pop("evaluatorId")

        name = d.pop("name")

        passed = d.pop("passed")

        failed = d.pop("failed")

        pass_rate = d.pop("passRate")

        avg_score = d.pop("avgScore", UNSET)

        get_api_experiments_runs_by_run_id_response_200_summary_evaluators_item = cls(
            evaluator_id=evaluator_id,
            name=name,
            passed=passed,
            failed=failed,
            pass_rate=pass_rate,
            avg_score=avg_score,
        )

        get_api_experiments_runs_by_run_id_response_200_summary_evaluators_item.additional_properties = d
        return get_api_experiments_runs_by_run_id_response_200_summary_evaluators_item

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
