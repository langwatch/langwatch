from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_suites_body_targets_item import PostApiSuitesBodyTargetsItem


T = TypeVar("T", bound="PostApiSuitesBody")


@_attrs_define
class PostApiSuitesBody:
    """
    Attributes:
        name (str):
        scenario_ids (list[str]):
        targets (list[PostApiSuitesBodyTargetsItem]):
        description (str | Unset):
        repeat_count (int | Unset):  Default: 1.
        labels (list[str] | Unset):
    """

    name: str
    scenario_ids: list[str]
    targets: list[PostApiSuitesBodyTargetsItem]
    description: str | Unset = UNSET
    repeat_count: int | Unset = 1
    labels: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        scenario_ids = self.scenario_ids

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)

        description = self.description

        repeat_count = self.repeat_count

        labels: list[str] | Unset = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "scenarioIds": scenario_ids,
                "targets": targets,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if repeat_count is not UNSET:
            field_dict["repeatCount"] = repeat_count
        if labels is not UNSET:
            field_dict["labels"] = labels

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_suites_body_targets_item import PostApiSuitesBodyTargetsItem

        d = dict(src_dict)
        name = d.pop("name")

        scenario_ids = cast(list[str], d.pop("scenarioIds"))

        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = PostApiSuitesBodyTargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

        description = d.pop("description", UNSET)

        repeat_count = d.pop("repeatCount", UNSET)

        labels = cast(list[str], d.pop("labels", UNSET))

        post_api_suites_body = cls(
            name=name,
            scenario_ids=scenario_ids,
            targets=targets,
            description=description,
            repeat_count=repeat_count,
            labels=labels,
        )

        post_api_suites_body.additional_properties = d
        return post_api_suites_body

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
