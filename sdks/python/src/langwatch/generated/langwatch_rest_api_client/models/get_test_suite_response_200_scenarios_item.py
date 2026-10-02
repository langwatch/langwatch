from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetTestSuiteResponse200ScenariosItem")


@_attrs_define
class GetTestSuiteResponse200ScenariosItem:
    """
    Attributes:
        id (str): The scenario id.
        name (str): The scenario name.
    """

    id: str
    name: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        get_test_suite_response_200_scenarios_item = cls(
            id=id,
            name=name,
        )

        return get_test_suite_response_200_scenarios_item
