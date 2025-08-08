from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenario_events_body_type_0_metadata import PostApiScenarioEventsBodyType0Metadata


T = TypeVar("T", bound="PostApiScenarioEventsBodyType0")


@_attrs_define
class PostApiScenarioEventsBodyType0:
    """
    Attributes:
        type_ (Literal['SCENARIO_RUN_STARTED']):
        timestamp (float):
        batch_run_id (str):
        scenario_id (str):
        scenario_run_id (str):
        metadata (PostApiScenarioEventsBodyType0Metadata):
        raw_event (Union[Unset, Any]):
        scenario_set_id (Union[Unset, str]):  Default: 'default'.
    """

    type_: Literal["SCENARIO_RUN_STARTED"]
    timestamp: float
    batch_run_id: str
    scenario_id: str
    scenario_run_id: str
    metadata: "PostApiScenarioEventsBodyType0Metadata"
    raw_event: Union[Unset, Any] = UNSET
    scenario_set_id: Union[Unset, str] = "default"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        timestamp = self.timestamp

        batch_run_id = self.batch_run_id

        scenario_id = self.scenario_id

        scenario_run_id = self.scenario_run_id

        metadata = self.metadata.to_dict()

        raw_event = self.raw_event

        scenario_set_id = self.scenario_set_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "timestamp": timestamp,
                "batchRunId": batch_run_id,
                "scenarioId": scenario_id,
                "scenarioRunId": scenario_run_id,
                "metadata": metadata,
            }
        )
        if raw_event is not UNSET:
            field_dict["rawEvent"] = raw_event
        if scenario_set_id is not UNSET:
            field_dict["scenarioSetId"] = scenario_set_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenario_events_body_type_0_metadata import PostApiScenarioEventsBodyType0Metadata

        d = dict(src_dict)
        type_ = cast(Literal["SCENARIO_RUN_STARTED"], d.pop("type"))
        if type_ != "SCENARIO_RUN_STARTED":
            raise ValueError(f"type must match const 'SCENARIO_RUN_STARTED', got '{type_}'")

        timestamp = d.pop("timestamp")

        batch_run_id = d.pop("batchRunId")

        scenario_id = d.pop("scenarioId")

        scenario_run_id = d.pop("scenarioRunId")

        metadata = PostApiScenarioEventsBodyType0Metadata.from_dict(d.pop("metadata"))

        raw_event = d.pop("rawEvent", UNSET)

        scenario_set_id = d.pop("scenarioSetId", UNSET)

        post_api_scenario_events_body_type_0 = cls(
            type_=type_,
            timestamp=timestamp,
            batch_run_id=batch_run_id,
            scenario_id=scenario_id,
            scenario_run_id=scenario_run_id,
            metadata=metadata,
            raw_event=raw_event,
            scenario_set_id=scenario_set_id,
        )

        post_api_scenario_events_body_type_0.additional_properties = d
        return post_api_scenario_events_body_type_0

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
