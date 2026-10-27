from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="RerunRunPlanResponse200SkippedArchived")


@_attrs_define
class RerunRunPlanResponse200SkippedArchived:
    """What the run left out, and why.

    Attributes:
        scenarios (list[str]): Scenarios left out because they are archived.
        targets (list[str]): Targets left out because they are archived.
    """

    scenarios: list[str]
    targets: list[str]

    def to_dict(self) -> dict[str, Any]:
        scenarios = self.scenarios

        targets = self.targets

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "scenarios": scenarios,
                "targets": targets,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scenarios = cast(list[str], d.pop("scenarios"))

        targets = cast(list[str], d.pop("targets"))

        rerun_run_plan_response_200_skipped_archived = cls(
            scenarios=scenarios,
            targets=targets,
        )

        return rerun_run_plan_response_200_skipped_archived
