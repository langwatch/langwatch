from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiSuitesByIdRunResponse200SkippedArchived")


@_attrs_define
class PostApiSuitesByIdRunResponse200SkippedArchived:
    """
    Attributes:
        scenarios (list[str]):
        targets (list[str]):
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

        post_api_suites_by_id_run_response_200_skipped_archived = cls(
            scenarios=scenarios,
            targets=targets,
        )

        return post_api_suites_by_id_run_response_200_skipped_archived
