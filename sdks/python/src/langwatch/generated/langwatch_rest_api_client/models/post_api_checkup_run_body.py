from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiCheckupRunBody")


@_attrs_define
class PostApiCheckupRunBody:
    """
    Attributes:
        checks (list[str] | Unset): The check ids to run. Omit to run every explicit check.
        scenario_run_plan_id (str | Unset): The run plan the scenario canary launches.
    """

    checks: list[str] | Unset = UNSET
    scenario_run_plan_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        checks: list[str] | Unset = UNSET
        if not isinstance(self.checks, Unset):
            checks = self.checks

        scenario_run_plan_id = self.scenario_run_plan_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if checks is not UNSET:
            field_dict["checks"] = checks
        if scenario_run_plan_id is not UNSET:
            field_dict["scenarioRunPlanId"] = scenario_run_plan_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        checks = cast(list[str], d.pop("checks", UNSET))

        scenario_run_plan_id = d.pop("scenarioRunPlanId", UNSET)

        post_api_checkup_run_body = cls(
            checks=checks,
            scenario_run_plan_id=scenario_run_plan_id,
        )

        post_api_checkup_run_body.additional_properties = d
        return post_api_checkup_run_body

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
