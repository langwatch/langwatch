from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_suites_by_id_duplicate_response_201_targets_item import (
        PostApiSuitesByIdDuplicateResponse201TargetsItem,
    )


T = TypeVar("T", bound="PostApiSuitesByIdDuplicateResponse201")


@_attrs_define
class PostApiSuitesByIdDuplicateResponse201:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        description (None | str):
        scenario_ids (list[str]):
        targets (list[PostApiSuitesByIdDuplicateResponse201TargetsItem]):
        repeat_count (float):
        labels (list[str]):
        created_at (str):
        updated_at (str):
    """

    id: str
    name: str
    slug: str
    description: None | str
    scenario_ids: list[str]
    targets: list[PostApiSuitesByIdDuplicateResponse201TargetsItem]
    repeat_count: float
    labels: list[str]
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        description: None | str
        description = self.description

        scenario_ids = self.scenario_ids

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)

        repeat_count = self.repeat_count

        labels = self.labels

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "description": description,
                "scenarioIds": scenario_ids,
                "targets": targets,
                "repeatCount": repeat_count,
                "labels": labels,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_suites_by_id_duplicate_response_201_targets_item import (
            PostApiSuitesByIdDuplicateResponse201TargetsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        scenario_ids = cast(list[str], d.pop("scenarioIds"))

        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = PostApiSuitesByIdDuplicateResponse201TargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

        repeat_count = d.pop("repeatCount")

        labels = cast(list[str], d.pop("labels"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        post_api_suites_by_id_duplicate_response_201 = cls(
            id=id,
            name=name,
            slug=slug,
            description=description,
            scenario_ids=scenario_ids,
            targets=targets,
            repeat_count=repeat_count,
            labels=labels,
            created_at=created_at,
            updated_at=updated_at,
        )

        post_api_suites_by_id_duplicate_response_201.additional_properties = d
        return post_api_suites_by_id_duplicate_response_201

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
