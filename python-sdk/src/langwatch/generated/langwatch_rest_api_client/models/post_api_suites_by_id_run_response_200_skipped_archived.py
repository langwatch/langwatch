from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scenarios = self.scenarios

        targets = self.targets

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_suites_by_id_run_response_200_skipped_archived.additional_properties = d
        return post_api_suites_by_id_run_response_200_skipped_archived

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
