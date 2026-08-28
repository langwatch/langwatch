from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_suites_by_id_body_scope_type_0 import PatchApiSuitesByIdBodyScopeType0
    from ..models.patch_api_suites_by_id_body_scope_type_1 import PatchApiSuitesByIdBodyScopeType1
    from ..models.patch_api_suites_by_id_body_scope_type_2 import PatchApiSuitesByIdBodyScopeType2
    from ..models.patch_api_suites_by_id_body_scope_type_3 import PatchApiSuitesByIdBodyScopeType3
    from ..models.patch_api_suites_by_id_body_targets_item import PatchApiSuitesByIdBodyTargetsItem


T = TypeVar("T", bound="PatchApiSuitesByIdBody")


@_attrs_define
class PatchApiSuitesByIdBody:
    """
    Attributes:
        name (str | Unset):
        description (None | str | Unset):
        scope (PatchApiSuitesByIdBodyScopeType0 | PatchApiSuitesByIdBodyScopeType1 | PatchApiSuitesByIdBodyScopeType2 |
            PatchApiSuitesByIdBodyScopeType3 | Unset): What the run plan covers: all (every active scenario), folders (the
            cases filed in the named test suites), labels (the cases carrying any of the labels), or cases (the scenarioIds
            below). A dynamic scope is resolved again at every run, so a scenario written later runs without editing the
            plan.
        scenario_ids (list[str] | Unset):
        targets (list[PatchApiSuitesByIdBodyTargetsItem] | Unset):
        repeat_count (int | Unset):
        labels (list[str] | Unset):
    """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    scope: (
        PatchApiSuitesByIdBodyScopeType0
        | PatchApiSuitesByIdBodyScopeType1
        | PatchApiSuitesByIdBodyScopeType2
        | PatchApiSuitesByIdBodyScopeType3
        | Unset
    ) = UNSET
    scenario_ids: list[str] | Unset = UNSET
    targets: list[PatchApiSuitesByIdBodyTargetsItem] | Unset = UNSET
    repeat_count: int | Unset = UNSET
    labels: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_suites_by_id_body_scope_type_0 import PatchApiSuitesByIdBodyScopeType0
        from ..models.patch_api_suites_by_id_body_scope_type_1 import PatchApiSuitesByIdBodyScopeType1
        from ..models.patch_api_suites_by_id_body_scope_type_2 import PatchApiSuitesByIdBodyScopeType2

        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        scope: dict[str, Any] | Unset
        if isinstance(self.scope, Unset):
            scope = UNSET
        elif isinstance(self.scope, PatchApiSuitesByIdBodyScopeType0):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PatchApiSuitesByIdBodyScopeType1):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PatchApiSuitesByIdBodyScopeType2):
            scope = self.scope.to_dict()
        else:
            scope = self.scope.to_dict()

        scenario_ids: list[str] | Unset = UNSET
        if not isinstance(self.scenario_ids, Unset):
            scenario_ids = self.scenario_ids

        targets: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.targets, Unset):
            targets = []
            for targets_item_data in self.targets:
                targets_item = targets_item_data.to_dict()
                targets.append(targets_item)

        repeat_count = self.repeat_count

        labels: list[str] | Unset = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if scope is not UNSET:
            field_dict["scope"] = scope
        if scenario_ids is not UNSET:
            field_dict["scenarioIds"] = scenario_ids
        if targets is not UNSET:
            field_dict["targets"] = targets
        if repeat_count is not UNSET:
            field_dict["repeatCount"] = repeat_count
        if labels is not UNSET:
            field_dict["labels"] = labels

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_suites_by_id_body_scope_type_0 import PatchApiSuitesByIdBodyScopeType0
        from ..models.patch_api_suites_by_id_body_scope_type_1 import PatchApiSuitesByIdBodyScopeType1
        from ..models.patch_api_suites_by_id_body_scope_type_2 import PatchApiSuitesByIdBodyScopeType2
        from ..models.patch_api_suites_by_id_body_scope_type_3 import PatchApiSuitesByIdBodyScopeType3
        from ..models.patch_api_suites_by_id_body_targets_item import PatchApiSuitesByIdBodyTargetsItem

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_scope(
            data: object,
        ) -> (
            PatchApiSuitesByIdBodyScopeType0
            | PatchApiSuitesByIdBodyScopeType1
            | PatchApiSuitesByIdBodyScopeType2
            | PatchApiSuitesByIdBodyScopeType3
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_0 = PatchApiSuitesByIdBodyScopeType0.from_dict(data)

                return scope_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_1 = PatchApiSuitesByIdBodyScopeType1.from_dict(data)

                return scope_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_2 = PatchApiSuitesByIdBodyScopeType2.from_dict(data)

                return scope_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            scope_type_3 = PatchApiSuitesByIdBodyScopeType3.from_dict(data)

            return scope_type_3

        scope = _parse_scope(d.pop("scope", UNSET))

        scenario_ids = cast(list[str], d.pop("scenarioIds", UNSET))

        _targets = d.pop("targets", UNSET)
        targets: list[PatchApiSuitesByIdBodyTargetsItem] | Unset = UNSET
        if _targets is not UNSET:
            targets = []
            for targets_item_data in _targets:
                targets_item = PatchApiSuitesByIdBodyTargetsItem.from_dict(targets_item_data)

                targets.append(targets_item)

        repeat_count = d.pop("repeatCount", UNSET)

        labels = cast(list[str], d.pop("labels", UNSET))

        patch_api_suites_by_id_body = cls(
            name=name,
            description=description,
            scope=scope,
            scenario_ids=scenario_ids,
            targets=targets,
            repeat_count=repeat_count,
            labels=labels,
        )

        patch_api_suites_by_id_body.additional_properties = d
        return patch_api_suites_by_id_body

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
