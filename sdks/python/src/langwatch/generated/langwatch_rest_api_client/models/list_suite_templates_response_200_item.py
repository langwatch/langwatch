from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.list_suite_templates_response_200_item_kind import ListSuiteTemplatesResponse200ItemKind

if TYPE_CHECKING:
    from ..models.list_suite_templates_response_200_item_scenarios_item import (
        ListSuiteTemplatesResponse200ItemScenariosItem,
    )


T = TypeVar("T", bound="ListSuiteTemplatesResponse200Item")


@_attrs_define
class ListSuiteTemplatesResponse200Item:
    """
    Attributes:
        id (str):
        version (int):
        kind (ListSuiteTemplatesResponse200ItemKind):
        title (str):
        description (str):
        criteria (list[str]):
        scenarios (list[ListSuiteTemplatesResponse200ItemScenariosItem]):
    """

    id: str
    version: int
    kind: ListSuiteTemplatesResponse200ItemKind
    title: str
    description: str
    criteria: list[str]
    scenarios: list[ListSuiteTemplatesResponse200ItemScenariosItem]

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        version = self.version

        kind = self.kind.value

        title = self.title

        description = self.description

        criteria = self.criteria

        scenarios = []
        for scenarios_item_data in self.scenarios:
            scenarios_item = scenarios_item_data.to_dict()
            scenarios.append(scenarios_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "version": version,
                "kind": kind,
                "title": title,
                "description": description,
                "criteria": criteria,
                "scenarios": scenarios,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_suite_templates_response_200_item_scenarios_item import (
            ListSuiteTemplatesResponse200ItemScenariosItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        version = d.pop("version")

        kind = ListSuiteTemplatesResponse200ItemKind(d.pop("kind"))

        title = d.pop("title")

        description = d.pop("description")

        criteria = cast(list[str], d.pop("criteria"))

        scenarios = []
        _scenarios = d.pop("scenarios")
        for scenarios_item_data in _scenarios:
            scenarios_item = ListSuiteTemplatesResponse200ItemScenariosItem.from_dict(scenarios_item_data)

            scenarios.append(scenarios_item)

        list_suite_templates_response_200_item = cls(
            id=id,
            version=version,
            kind=kind,
            title=title,
            description=description,
            criteria=criteria,
            scenarios=scenarios,
        )

        return list_suite_templates_response_200_item
