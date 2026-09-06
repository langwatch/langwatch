from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error import (
        GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainError,
    )
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item_entry import (
        GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemEntry,
    )
    from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item_predicted import (
        GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemPredicted,
    )


T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResultsResponse200DatasetItem")


@_attrs_define
class GetApiExperimentsRunsByRunIdResultsResponse200DatasetItem:
    """
    Attributes:
        index (float):
        entry (GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemEntry):
        target_id (None | str | Unset):
        predicted (GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemPredicted | Unset):
        cost (float | None | Unset):
        duration (float | None | Unset):
        error (None | str | Unset): The engine's own string. Prefer domainError.code to branch on
        domain_error (GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainError | Unset): Set on rows written
            since failures started carrying codes
        trace_id (None | str | Unset):
    """

    index: float
    entry: GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemEntry
    target_id: None | str | Unset = UNSET
    predicted: GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemPredicted | Unset = UNSET
    cost: float | None | Unset = UNSET
    duration: float | None | Unset = UNSET
    error: None | str | Unset = UNSET
    domain_error: GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainError | Unset = UNSET
    trace_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        index = self.index

        entry = self.entry.to_dict()

        target_id: None | str | Unset
        if isinstance(self.target_id, Unset):
            target_id = UNSET
        else:
            target_id = self.target_id

        predicted: dict[str, Any] | Unset = UNSET
        if not isinstance(self.predicted, Unset):
            predicted = self.predicted.to_dict()

        cost: float | None | Unset
        if isinstance(self.cost, Unset):
            cost = UNSET
        else:
            cost = self.cost

        duration: float | None | Unset
        if isinstance(self.duration, Unset):
            duration = UNSET
        else:
            duration = self.duration

        error: None | str | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        else:
            error = self.error

        domain_error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.domain_error, Unset):
            domain_error = self.domain_error.to_dict()

        trace_id: None | str | Unset
        if isinstance(self.trace_id, Unset):
            trace_id = UNSET
        else:
            trace_id = self.trace_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "index": index,
                "entry": entry,
            }
        )
        if target_id is not UNSET:
            field_dict["targetId"] = target_id
        if predicted is not UNSET:
            field_dict["predicted"] = predicted
        if cost is not UNSET:
            field_dict["cost"] = cost
        if duration is not UNSET:
            field_dict["duration"] = duration
        if error is not UNSET:
            field_dict["error"] = error
        if domain_error is not UNSET:
            field_dict["domainError"] = domain_error
        if trace_id is not UNSET:
            field_dict["traceId"] = trace_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item_domain_error import (
            GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainError,
        )
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item_entry import (
            GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemEntry,
        )
        from ..models.get_api_experiments_runs_by_run_id_results_response_200_dataset_item_predicted import (
            GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemPredicted,
        )

        d = dict(src_dict)
        index = d.pop("index")

        entry = GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemEntry.from_dict(d.pop("entry"))

        def _parse_target_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        target_id = _parse_target_id(d.pop("targetId", UNSET))

        _predicted = d.pop("predicted", UNSET)
        predicted: GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemPredicted | Unset
        if isinstance(_predicted, Unset):
            predicted = UNSET
        else:
            predicted = GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemPredicted.from_dict(_predicted)

        def _parse_cost(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        cost = _parse_cost(d.pop("cost", UNSET))

        def _parse_duration(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        duration = _parse_duration(d.pop("duration", UNSET))

        def _parse_error(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        _domain_error = d.pop("domainError", UNSET)
        domain_error: GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainError | Unset
        if isinstance(_domain_error, Unset):
            domain_error = UNSET
        else:
            domain_error = GetApiExperimentsRunsByRunIdResultsResponse200DatasetItemDomainError.from_dict(_domain_error)

        def _parse_trace_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        trace_id = _parse_trace_id(d.pop("traceId", UNSET))

        get_api_experiments_runs_by_run_id_results_response_200_dataset_item = cls(
            index=index,
            entry=entry,
            target_id=target_id,
            predicted=predicted,
            cost=cost,
            duration=duration,
            error=error,
            domain_error=domain_error,
            trace_id=trace_id,
        )

        get_api_experiments_runs_by_run_id_results_response_200_dataset_item.additional_properties = d
        return get_api_experiments_runs_by_run_id_results_response_200_dataset_item

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
