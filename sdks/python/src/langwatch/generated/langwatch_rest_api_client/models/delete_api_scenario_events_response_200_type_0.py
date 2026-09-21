from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="DeleteApiScenarioEventsResponse200Type0")


@_attrs_define
class DeleteApiScenarioEventsResponse200Type0:
    """
    Attributes:
        archived (int):
        failed (int):
        scenario_set_id (str):
        has_more (bool):
    """

    archived: int
    failed: int
    scenario_set_id: str
    has_more: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        archived = self.archived

        failed = self.failed

        scenario_set_id = self.scenario_set_id

        has_more = self.has_more

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "archived": archived,
                "failed": failed,
                "scenarioSetId": scenario_set_id,
                "hasMore": has_more,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        archived = d.pop("archived")

        failed = d.pop("failed")

        scenario_set_id = d.pop("scenarioSetId")

        has_more = d.pop("hasMore")

        delete_api_scenario_events_response_200_type_0 = cls(
            archived=archived,
            failed=failed,
            scenario_set_id=scenario_set_id,
            has_more=has_more,
        )

        delete_api_scenario_events_response_200_type_0.additional_properties = d
        return delete_api_scenario_events_response_200_type_0

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
