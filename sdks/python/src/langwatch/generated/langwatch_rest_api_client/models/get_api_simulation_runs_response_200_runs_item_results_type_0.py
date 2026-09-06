from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_simulation_runs_response_200_runs_item_results_type_0_evaluations_item import (
        GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItem,
    )


T = TypeVar("T", bound="GetApiSimulationRunsResponse200RunsItemResultsType0")


@_attrs_define
class GetApiSimulationRunsResponse200RunsItemResultsType0:
    """
    Attributes:
        verdict (None | str | Unset):
        reasoning (None | str | Unset):
        met_criteria (list[str] | Unset):
        unmet_criteria (list[str] | Unset):
        error (None | str | Unset):
        evaluations (list[GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItem] | Unset): One result per
            evaluator that ran on the scenario. Absent on a run with no evaluators, and on servers that predate evaluators.
    """

    verdict: None | str | Unset = UNSET
    reasoning: None | str | Unset = UNSET
    met_criteria: list[str] | Unset = UNSET
    unmet_criteria: list[str] | Unset = UNSET
    error: None | str | Unset = UNSET
    evaluations: list[GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        verdict: None | str | Unset
        if isinstance(self.verdict, Unset):
            verdict = UNSET
        else:
            verdict = self.verdict

        reasoning: None | str | Unset
        if isinstance(self.reasoning, Unset):
            reasoning = UNSET
        else:
            reasoning = self.reasoning

        met_criteria: list[str] | Unset = UNSET
        if not isinstance(self.met_criteria, Unset):
            met_criteria = self.met_criteria

        unmet_criteria: list[str] | Unset = UNSET
        if not isinstance(self.unmet_criteria, Unset):
            unmet_criteria = self.unmet_criteria

        error: None | str | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        else:
            error = self.error

        evaluations: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluations, Unset):
            evaluations = []
            for evaluations_item_data in self.evaluations:
                evaluations_item = evaluations_item_data.to_dict()
                evaluations.append(evaluations_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if verdict is not UNSET:
            field_dict["verdict"] = verdict
        if reasoning is not UNSET:
            field_dict["reasoning"] = reasoning
        if met_criteria is not UNSET:
            field_dict["metCriteria"] = met_criteria
        if unmet_criteria is not UNSET:
            field_dict["unmetCriteria"] = unmet_criteria
        if error is not UNSET:
            field_dict["error"] = error
        if evaluations is not UNSET:
            field_dict["evaluations"] = evaluations

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_simulation_runs_response_200_runs_item_results_type_0_evaluations_item import (
            GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItem,
        )

        d = dict(src_dict)

        def _parse_verdict(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        verdict = _parse_verdict(d.pop("verdict", UNSET))

        def _parse_reasoning(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        reasoning = _parse_reasoning(d.pop("reasoning", UNSET))

        met_criteria = cast(list[str], d.pop("metCriteria", UNSET))

        unmet_criteria = cast(list[str], d.pop("unmetCriteria", UNSET))

        def _parse_error(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        _evaluations = d.pop("evaluations", UNSET)
        evaluations: list[GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItem] | Unset = UNSET
        if _evaluations is not UNSET:
            evaluations = []
            for evaluations_item_data in _evaluations:
                evaluations_item = GetApiSimulationRunsResponse200RunsItemResultsType0EvaluationsItem.from_dict(
                    evaluations_item_data
                )

                evaluations.append(evaluations_item)

        get_api_simulation_runs_response_200_runs_item_results_type_0 = cls(
            verdict=verdict,
            reasoning=reasoning,
            met_criteria=met_criteria,
            unmet_criteria=unmet_criteria,
            error=error,
            evaluations=evaluations,
        )

        get_api_simulation_runs_response_200_runs_item_results_type_0.additional_properties = d
        return get_api_simulation_runs_response_200_runs_item_results_type_0

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
