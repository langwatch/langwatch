from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResponse200SummaryTargetsItem")


@_attrs_define
class GetApiExperimentsRunsByRunIdResponse200SummaryTargetsItem:
    """
    Attributes:
        target_id (str):
        name (str):
        passed (float):
        failed (float):
        avg_latency (float):
        total_cost (float):
    """

    target_id: str
    name: str
    passed: float
    failed: float
    avg_latency: float
    total_cost: float

    def to_dict(self) -> dict[str, Any]:
        target_id = self.target_id

        name = self.name

        passed = self.passed

        failed = self.failed

        avg_latency = self.avg_latency

        total_cost = self.total_cost

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "targetId": target_id,
                "name": name,
                "passed": passed,
                "failed": failed,
                "avgLatency": avg_latency,
                "totalCost": total_cost,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        target_id = d.pop("targetId")

        name = d.pop("name")

        passed = d.pop("passed")

        failed = d.pop("failed")

        avg_latency = d.pop("avgLatency")

        total_cost = d.pop("totalCost")

        get_api_experiments_runs_by_run_id_response_200_summary_targets_item = cls(
            target_id=target_id,
            name=name,
            passed=passed,
            failed=failed,
            avg_latency=avg_latency,
            total_cost=total_cost,
        )

        return get_api_experiments_runs_by_run_id_response_200_summary_targets_item
