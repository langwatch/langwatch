from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiScenarioEventsBrowserTabBody")


@_attrs_define
class PostApiScenarioEventsBrowserTabBody:
    """
    Attributes:
        tab_key (str):
        batch_run_id (str):
        scenario_set_id (str | Unset):
    """

    tab_key: str
    batch_run_id: str
    scenario_set_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        tab_key = self.tab_key

        batch_run_id = self.batch_run_id

        scenario_set_id = self.scenario_set_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "tabKey": tab_key,
                "batchRunId": batch_run_id,
            }
        )
        if scenario_set_id is not UNSET:
            field_dict["scenarioSetId"] = scenario_set_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        tab_key = d.pop("tabKey")

        batch_run_id = d.pop("batchRunId")

        scenario_set_id = d.pop("scenarioSetId", UNSET)

        post_api_scenario_events_browser_tab_body = cls(
            tab_key=tab_key,
            batch_run_id=batch_run_id,
            scenario_set_id=scenario_set_id,
        )

        post_api_scenario_events_browser_tab_body.additional_properties = d
        return post_api_scenario_events_browser_tab_body

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
