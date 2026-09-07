from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_scenario_events_body_type_1_results_type_0_verdict import (
    PostApiScenarioEventsBodyType1ResultsType0Verdict,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_1_results_type_0_evaluations_item import (
        PostApiScenarioEventsBodyType1ResultsType0EvaluationsItem,
    )


T = TypeVar("T", bound="PostApiScenarioEventsBodyType1ResultsType0")


@_attrs_define
class PostApiScenarioEventsBodyType1ResultsType0:
    """
    Attributes:
        verdict (PostApiScenarioEventsBodyType1ResultsType0Verdict):
        met_criteria (list[str]):
        unmet_criteria (list[str]):
        reasoning (str | Unset):
        error (str | Unset):
        evaluations (list[PostApiScenarioEventsBodyType1ResultsType0EvaluationsItem] | Unset):
    """

    verdict: PostApiScenarioEventsBodyType1ResultsType0Verdict
    met_criteria: list[str]
    unmet_criteria: list[str]
    reasoning: str | Unset = UNSET
    error: str | Unset = UNSET
    evaluations: list[PostApiScenarioEventsBodyType1ResultsType0EvaluationsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        verdict = self.verdict.value

        met_criteria = self.met_criteria

        unmet_criteria = self.unmet_criteria

        reasoning = self.reasoning

        error = self.error

        evaluations: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluations, Unset):
            evaluations = []
            for evaluations_item_data in self.evaluations:
                evaluations_item = evaluations_item_data.to_dict()
                evaluations.append(evaluations_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "verdict": verdict,
                "metCriteria": met_criteria,
                "unmetCriteria": unmet_criteria,
            }
        )
        if reasoning is not UNSET:
            field_dict["reasoning"] = reasoning
        if error is not UNSET:
            field_dict["error"] = error
        if evaluations is not UNSET:
            field_dict["evaluations"] = evaluations

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_1_results_type_0_evaluations_item import (
            PostApiScenarioEventsBodyType1ResultsType0EvaluationsItem,
        )

        d = dict(src_dict)
        verdict = PostApiScenarioEventsBodyType1ResultsType0Verdict(d.pop("verdict"))

        met_criteria = cast(list[str], d.pop("metCriteria"))

        unmet_criteria = cast(list[str], d.pop("unmetCriteria"))

        reasoning = d.pop("reasoning", UNSET)

        error = d.pop("error", UNSET)

        _evaluations = d.pop("evaluations", UNSET)
        evaluations: list[PostApiScenarioEventsBodyType1ResultsType0EvaluationsItem] | Unset = UNSET
        if _evaluations is not UNSET:
            evaluations = []
            for evaluations_item_data in _evaluations:
                evaluations_item = PostApiScenarioEventsBodyType1ResultsType0EvaluationsItem.from_dict(
                    evaluations_item_data
                )

                evaluations.append(evaluations_item)

        post_api_scenario_events_body_type_1_results_type_0 = cls(
            verdict=verdict,
            met_criteria=met_criteria,
            unmet_criteria=unmet_criteria,
            reasoning=reasoning,
            error=error,
            evaluations=evaluations,
        )

        post_api_scenario_events_body_type_1_results_type_0.additional_properties = d
        return post_api_scenario_events_body_type_1_results_type_0

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
