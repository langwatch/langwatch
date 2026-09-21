from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_by_run_id_response_200_summary_evaluators_item import (
        GetApiExperimentsRunsByRunIdResponse200SummaryEvaluatorsItem,
    )
    from ..models.get_api_experiments_runs_by_run_id_response_200_summary_targets_item import (
        GetApiExperimentsRunsByRunIdResponse200SummaryTargetsItem,
    )
    from ..models.get_api_experiments_runs_by_run_id_response_200_summary_timestamps import (
        GetApiExperimentsRunsByRunIdResponse200SummaryTimestamps,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResponse200Summary")


@_attrs_define
class GetApiExperimentsRunsByRunIdResponse200Summary:
    """Present when completed

    Attributes:
        run_id (str):
        total_cells (float): Cells the run set out to execute
        completed_cells (float):
        failed_cells (float):
        duration (float): Wall-clock milliseconds
        timestamps (GetApiExperimentsRunsByRunIdResponse200SummaryTimestamps):
        ch_dispatch_failures (float | Unset): Non-zero means some rows may be missing from the stored results
        targets (list[GetApiExperimentsRunsByRunIdResponse200SummaryTargetsItem] | Unset):
        evaluators (list[GetApiExperimentsRunsByRunIdResponse200SummaryEvaluatorsItem] | Unset):
        total_passed (float | Unset):
        total_failed (float | Unset):
        pass_rate (float | Unset):
        total_cost (float | Unset):
        run_url (str | Unset): Link to the run in the LangWatch app
    """

    run_id: str
    total_cells: float
    completed_cells: float
    failed_cells: float
    duration: float
    timestamps: GetApiExperimentsRunsByRunIdResponse200SummaryTimestamps
    ch_dispatch_failures: float | Unset = UNSET
    targets: list[GetApiExperimentsRunsByRunIdResponse200SummaryTargetsItem] | Unset = UNSET
    evaluators: list[GetApiExperimentsRunsByRunIdResponse200SummaryEvaluatorsItem] | Unset = UNSET
    total_passed: float | Unset = UNSET
    total_failed: float | Unset = UNSET
    pass_rate: float | Unset = UNSET
    total_cost: float | Unset = UNSET
    run_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        total_cells = self.total_cells

        completed_cells = self.completed_cells

        failed_cells = self.failed_cells

        duration = self.duration

        timestamps = self.timestamps.to_dict()

        ch_dispatch_failures = self.ch_dispatch_failures

        targets: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.targets, Unset):
            targets = []
            for targets_item_data in self.targets:
                targets_item = targets_item_data.to_dict()
                targets.append(targets_item)

        evaluators: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluators, Unset):
            evaluators = []
            for evaluators_item_data in self.evaluators:
                evaluators_item = evaluators_item_data.to_dict()
                evaluators.append(evaluators_item)

        total_passed = self.total_passed

        total_failed = self.total_failed

        pass_rate = self.pass_rate

        total_cost = self.total_cost

        run_url = self.run_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "runId": run_id,
                "totalCells": total_cells,
                "completedCells": completed_cells,
                "failedCells": failed_cells,
                "duration": duration,
                "timestamps": timestamps,
            }
        )
        if ch_dispatch_failures is not UNSET:
            field_dict["chDispatchFailures"] = ch_dispatch_failures
        if targets is not UNSET:
            field_dict["targets"] = targets
        if evaluators is not UNSET:
            field_dict["evaluators"] = evaluators
        if total_passed is not UNSET:
            field_dict["totalPassed"] = total_passed
        if total_failed is not UNSET:
            field_dict["totalFailed"] = total_failed
        if pass_rate is not UNSET:
            field_dict["passRate"] = pass_rate
        if total_cost is not UNSET:
            field_dict["totalCost"] = total_cost
        if run_url is not UNSET:
            field_dict["runUrl"] = run_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_by_run_id_response_200_summary_evaluators_item import (
            GetApiExperimentsRunsByRunIdResponse200SummaryEvaluatorsItem,
        )
        from ..models.get_api_experiments_runs_by_run_id_response_200_summary_targets_item import (
            GetApiExperimentsRunsByRunIdResponse200SummaryTargetsItem,
        )
        from ..models.get_api_experiments_runs_by_run_id_response_200_summary_timestamps import (
            GetApiExperimentsRunsByRunIdResponse200SummaryTimestamps,
        )

        d = dict(src_dict)
        run_id = d.pop("runId")

        total_cells = d.pop("totalCells")

        completed_cells = d.pop("completedCells")

        failed_cells = d.pop("failedCells")

        duration = d.pop("duration")

        timestamps = GetApiExperimentsRunsByRunIdResponse200SummaryTimestamps.from_dict(d.pop("timestamps"))

        ch_dispatch_failures = d.pop("chDispatchFailures", UNSET)

        _targets = d.pop("targets", UNSET)
        targets: list[GetApiExperimentsRunsByRunIdResponse200SummaryTargetsItem] | Unset = UNSET
        if _targets is not UNSET:
            targets = []
            for targets_item_data in _targets:
                targets_item = GetApiExperimentsRunsByRunIdResponse200SummaryTargetsItem.from_dict(targets_item_data)

                targets.append(targets_item)

        _evaluators = d.pop("evaluators", UNSET)
        evaluators: list[GetApiExperimentsRunsByRunIdResponse200SummaryEvaluatorsItem] | Unset = UNSET
        if _evaluators is not UNSET:
            evaluators = []
            for evaluators_item_data in _evaluators:
                evaluators_item = GetApiExperimentsRunsByRunIdResponse200SummaryEvaluatorsItem.from_dict(
                    evaluators_item_data
                )

                evaluators.append(evaluators_item)

        total_passed = d.pop("totalPassed", UNSET)

        total_failed = d.pop("totalFailed", UNSET)

        pass_rate = d.pop("passRate", UNSET)

        total_cost = d.pop("totalCost", UNSET)

        run_url = d.pop("runUrl", UNSET)

        get_api_experiments_runs_by_run_id_response_200_summary = cls(
            run_id=run_id,
            total_cells=total_cells,
            completed_cells=completed_cells,
            failed_cells=failed_cells,
            duration=duration,
            timestamps=timestamps,
            ch_dispatch_failures=ch_dispatch_failures,
            targets=targets,
            evaluators=evaluators,
            total_passed=total_passed,
            total_failed=total_failed,
            pass_rate=pass_rate,
            total_cost=total_cost,
            run_url=run_url,
        )

        get_api_experiments_runs_by_run_id_response_200_summary.additional_properties = d
        return get_api_experiments_runs_by_run_id_response_200_summary

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
