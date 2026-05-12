from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_suites_by_id_run_response_200_items_item_target import (
        PostApiSuitesByIdRunResponse200ItemsItemTarget,
    )


T = TypeVar("T", bound="PostApiSuitesByIdRunResponse200ItemsItem")


@_attrs_define
class PostApiSuitesByIdRunResponse200ItemsItem:
    """
    Attributes:
        scenario_run_id (str):
        scenario_id (str):
        target (PostApiSuitesByIdRunResponse200ItemsItemTarget):
        name (None | str):
    """

    scenario_run_id: str
    scenario_id: str
    target: PostApiSuitesByIdRunResponse200ItemsItemTarget
    name: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scenario_run_id = self.scenario_run_id

        scenario_id = self.scenario_id

        target = self.target.to_dict()

        name: None | str
        name = self.name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scenarioRunId": scenario_run_id,
                "scenarioId": scenario_id,
                "target": target,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_suites_by_id_run_response_200_items_item_target import (
            PostApiSuitesByIdRunResponse200ItemsItemTarget,
        )

        d = dict(src_dict)
        scenario_run_id = d.pop("scenarioRunId")

        scenario_id = d.pop("scenarioId")

        target = PostApiSuitesByIdRunResponse200ItemsItemTarget.from_dict(d.pop("target"))

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        post_api_suites_by_id_run_response_200_items_item = cls(
            scenario_run_id=scenario_run_id,
            scenario_id=scenario_id,
            target=target,
            name=name,
        )

        post_api_suites_by_id_run_response_200_items_item.additional_properties = d
        return post_api_suites_by_id_run_response_200_items_item

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
