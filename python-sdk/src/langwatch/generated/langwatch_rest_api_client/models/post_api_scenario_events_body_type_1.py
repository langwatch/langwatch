from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_scenario_events_body_type_1_status import PostApiScenarioEventsBodyType1Status
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_1_results_type_0 import PostApiScenarioEventsBodyType1ResultsType0


T = TypeVar("T", bound="PostApiScenarioEventsBodyType1")


@_attrs_define
class PostApiScenarioEventsBodyType1:
    """
    Attributes:
        type_ (Literal['SCENARIO_RUN_FINISHED']):
        timestamp (float):
        batch_run_id (str):
        scenario_id (str):
        scenario_run_id (str):
        status (PostApiScenarioEventsBodyType1Status):
        raw_event (Any | Unset):
        scenario_set_id (str | Unset):  Default: 'default'.
        results (None | PostApiScenarioEventsBodyType1ResultsType0 | Unset):
    """

    type_: Literal["SCENARIO_RUN_FINISHED"]
    timestamp: float
    batch_run_id: str
    scenario_id: str
    scenario_run_id: str
    status: PostApiScenarioEventsBodyType1Status
    raw_event: Any | Unset = UNSET
    scenario_set_id: str | Unset = "default"
    results: None | PostApiScenarioEventsBodyType1ResultsType0 | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_scenario_events_body_type_1_results_type_0 import (
            PostApiScenarioEventsBodyType1ResultsType0,
        )

        type_ = self.type_

        timestamp = self.timestamp

        batch_run_id = self.batch_run_id

        scenario_id = self.scenario_id

        scenario_run_id = self.scenario_run_id

        status = self.status.value

        raw_event = self.raw_event

        scenario_set_id = self.scenario_set_id

        results: dict[str, Any] | None | Unset
        if isinstance(self.results, Unset):
            results = UNSET
        elif isinstance(self.results, PostApiScenarioEventsBodyType1ResultsType0):
            results = self.results.to_dict()
        else:
            results = self.results

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "timestamp": timestamp,
                "batchRunId": batch_run_id,
                "scenarioId": scenario_id,
                "scenarioRunId": scenario_run_id,
                "status": status,
            }
        )
        if raw_event is not UNSET:
            field_dict["rawEvent"] = raw_event
        if scenario_set_id is not UNSET:
            field_dict["scenarioSetId"] = scenario_set_id
        if results is not UNSET:
            field_dict["results"] = results

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_1_results_type_0 import (
            PostApiScenarioEventsBodyType1ResultsType0,
        )

        d = dict(src_dict)
        type_ = cast(Literal["SCENARIO_RUN_FINISHED"], d.pop("type"))
        if type_ != "SCENARIO_RUN_FINISHED":
            raise ValueError(f"type must match const 'SCENARIO_RUN_FINISHED', got '{type_}'")

        timestamp = d.pop("timestamp")

        batch_run_id = d.pop("batchRunId")

        scenario_id = d.pop("scenarioId")

        scenario_run_id = d.pop("scenarioRunId")

        status = PostApiScenarioEventsBodyType1Status(d.pop("status"))

        raw_event = d.pop("rawEvent", UNSET)

        scenario_set_id = d.pop("scenarioSetId", UNSET)

        def _parse_results(data: object) -> None | PostApiScenarioEventsBodyType1ResultsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                results_type_0 = PostApiScenarioEventsBodyType1ResultsType0.from_dict(data)

                return results_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiScenarioEventsBodyType1ResultsType0 | Unset, data)

        results = _parse_results(d.pop("results", UNSET))

        post_api_scenario_events_body_type_1 = cls(
            type_=type_,
            timestamp=timestamp,
            batch_run_id=batch_run_id,
            scenario_id=scenario_id,
            scenario_run_id=scenario_run_id,
            status=status,
            raw_event=raw_event,
            scenario_set_id=scenario_set_id,
            results=results,
        )

        post_api_scenario_events_body_type_1.additional_properties = d
        return post_api_scenario_events_body_type_1

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
