from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_response_200_runs_item_summary import (
        GetApiExperimentsRunsResponse200RunsItemSummary,
    )
    from ..models.get_api_experiments_runs_response_200_runs_item_timestamps import (
        GetApiExperimentsRunsResponse200RunsItemTimestamps,
    )
    from ..models.get_api_experiments_runs_response_200_runs_item_workflow_version_type_0 import (
        GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsResponse200RunsItem")


@_attrs_define
class GetApiExperimentsRunsResponse200RunsItem:
    """
    Attributes:
        experiment_id (str):
        run_id (str):
        workflow_version (GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0 | None):
        timestamps (GetApiExperimentsRunsResponse200RunsItemTimestamps):
        summary (GetApiExperimentsRunsResponse200RunsItemSummary):
        progress (float | None | Unset):
        total (float | None | Unset):
    """

    experiment_id: str
    run_id: str
    workflow_version: GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0 | None
    timestamps: GetApiExperimentsRunsResponse200RunsItemTimestamps
    summary: GetApiExperimentsRunsResponse200RunsItemSummary
    progress: float | None | Unset = UNSET
    total: float | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_experiments_runs_response_200_runs_item_workflow_version_type_0 import (
            GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0,
        )

        experiment_id = self.experiment_id

        run_id = self.run_id

        workflow_version: dict[str, Any] | None
        if isinstance(self.workflow_version, GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0):
            workflow_version = self.workflow_version.to_dict()
        else:
            workflow_version = self.workflow_version

        timestamps = self.timestamps.to_dict()

        summary = self.summary.to_dict()

        progress: float | None | Unset
        if isinstance(self.progress, Unset):
            progress = UNSET
        else:
            progress = self.progress

        total: float | None | Unset
        if isinstance(self.total, Unset):
            total = UNSET
        else:
            total = self.total

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "experimentId": experiment_id,
                "runId": run_id,
                "workflowVersion": workflow_version,
                "timestamps": timestamps,
                "summary": summary,
            }
        )
        if progress is not UNSET:
            field_dict["progress"] = progress
        if total is not UNSET:
            field_dict["total"] = total

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_response_200_runs_item_summary import (
            GetApiExperimentsRunsResponse200RunsItemSummary,
        )
        from ..models.get_api_experiments_runs_response_200_runs_item_timestamps import (
            GetApiExperimentsRunsResponse200RunsItemTimestamps,
        )
        from ..models.get_api_experiments_runs_response_200_runs_item_workflow_version_type_0 import (
            GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0,
        )

        d = dict(src_dict)
        experiment_id = d.pop("experimentId")

        run_id = d.pop("runId")

        def _parse_workflow_version(
            data: object,
        ) -> GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                workflow_version_type_0 = GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0.from_dict(data)

                return workflow_version_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiExperimentsRunsResponse200RunsItemWorkflowVersionType0 | None, data)

        workflow_version = _parse_workflow_version(d.pop("workflowVersion"))

        timestamps = GetApiExperimentsRunsResponse200RunsItemTimestamps.from_dict(d.pop("timestamps"))

        summary = GetApiExperimentsRunsResponse200RunsItemSummary.from_dict(d.pop("summary"))

        def _parse_progress(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        progress = _parse_progress(d.pop("progress", UNSET))

        def _parse_total(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        total = _parse_total(d.pop("total", UNSET))

        get_api_experiments_runs_response_200_runs_item = cls(
            experiment_id=experiment_id,
            run_id=run_id,
            workflow_version=workflow_version,
            timestamps=timestamps,
            summary=summary,
            progress=progress,
            total=total,
        )

        return get_api_experiments_runs_response_200_runs_item
