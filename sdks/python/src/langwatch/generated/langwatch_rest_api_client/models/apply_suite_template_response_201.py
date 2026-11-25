from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ApplySuiteTemplateResponse201")


@_attrs_define
class ApplySuiteTemplateResponse201:
    """
    Attributes:
        suite_id (str):
        slug (str):
        name (str):
        scenario_ids (list[str]):
    """

    suite_id: str
    slug: str
    name: str
    scenario_ids: list[str]

    def to_dict(self) -> dict[str, Any]:
        suite_id = self.suite_id

        slug = self.slug

        name = self.name

        scenario_ids = self.scenario_ids

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "suiteId": suite_id,
                "slug": slug,
                "name": name,
                "scenarioIds": scenario_ids,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        suite_id = d.pop("suiteId")

        slug = d.pop("slug")

        name = d.pop("name")

        scenario_ids = cast(list[str], d.pop("scenarioIds"))

        apply_suite_template_response_201 = cls(
            suite_id=suite_id,
            slug=slug,
            name=name,
            scenario_ids=scenario_ids,
        )

        return apply_suite_template_response_201
