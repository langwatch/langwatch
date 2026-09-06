from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_suites_body_kind import PostApiSuitesBodyKind
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_suites_body_scope_type_0 import PostApiSuitesBodyScopeType0
    from ..models.post_api_suites_body_scope_type_1 import PostApiSuitesBodyScopeType1
    from ..models.post_api_suites_body_scope_type_2 import PostApiSuitesBodyScopeType2
    from ..models.post_api_suites_body_scope_type_3 import PostApiSuitesBodyScopeType3
    from ..models.post_api_suites_body_targets_item import PostApiSuitesBodyTargetsItem


T = TypeVar("T", bound="PostApiSuitesBody")


@_attrs_define
class PostApiSuitesBody:
    """
    Attributes:
        name (str):
        kind (PostApiSuitesBodyKind | Unset): custom (the default) is a run plan and needs scenarioIds and targets;
            folder is a test suite that starts empty and gets scenarios by filing them into it. Default:
            PostApiSuitesBodyKind.CUSTOM.
        description (str | Unset):
        scenario_ids (list[str] | Unset):
        scope (PostApiSuitesBodyScopeType0 | PostApiSuitesBodyScopeType1 | PostApiSuitesBodyScopeType2 |
            PostApiSuitesBodyScopeType3 | Unset): What the run plan covers: all (every active scenario), folders (the
            scenarios filed in the named test suites), labels (the scenarios carrying any of the labels), or cases (the
            scenarioIds below). A dynamic scope is resolved again at every run, so a scenario written later runs without
            editing the plan.
        targets (list[PostApiSuitesBodyTargetsItem] | Unset):
        repeat_count (int | Unset):  Default: 1.
        labels (list[str] | Unset):
    """

    name: str
    kind: PostApiSuitesBodyKind | Unset = PostApiSuitesBodyKind.CUSTOM
    description: str | Unset = UNSET
    scenario_ids: list[str] | Unset = UNSET
    scope: (
        PostApiSuitesBodyScopeType0
        | PostApiSuitesBodyScopeType1
        | PostApiSuitesBodyScopeType2
        | PostApiSuitesBodyScopeType3
        | Unset
    ) = UNSET
    targets: list[PostApiSuitesBodyTargetsItem] | Unset = UNSET
    repeat_count: int | Unset = 1
    labels: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_suites_body_scope_type_0 import PostApiSuitesBodyScopeType0
        from ..models.post_api_suites_body_scope_type_1 import PostApiSuitesBodyScopeType1
        from ..models.post_api_suites_body_scope_type_2 import PostApiSuitesBodyScopeType2

        name = self.name

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind.value

        description = self.description

        scenario_ids: list[str] | Unset = UNSET
        if not isinstance(self.scenario_ids, Unset):
            scenario_ids = self.scenario_ids

        scope: dict[str, Any] | Unset
        if isinstance(self.scope, Unset):
            scope = UNSET
        elif isinstance(self.scope, PostApiSuitesBodyScopeType0):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiSuitesBodyScopeType1):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiSuitesBodyScopeType2):
            scope = self.scope.to_dict()
        else:
            scope = self.scope.to_dict()

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
        field_dict.update(
            {
                "name": name,
            }
        )
        if kind is not UNSET:
            field_dict["kind"] = kind
        if description is not UNSET:
            field_dict["description"] = description
        if scenario_ids is not UNSET:
            field_dict["scenarioIds"] = scenario_ids
        if scope is not UNSET:
            field_dict["scope"] = scope
        if targets is not UNSET:
            field_dict["targets"] = targets
        if repeat_count is not UNSET:
            field_dict["repeatCount"] = repeat_count
        if labels is not UNSET:
            field_dict["labels"] = labels

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_suites_body_scope_type_0 import PostApiSuitesBodyScopeType0
        from ..models.post_api_suites_body_scope_type_1 import PostApiSuitesBodyScopeType1
        from ..models.post_api_suites_body_scope_type_2 import PostApiSuitesBodyScopeType2
        from ..models.post_api_suites_body_scope_type_3 import PostApiSuitesBodyScopeType3
        from ..models.post_api_suites_body_targets_item import PostApiSuitesBodyTargetsItem

        d = dict(src_dict)
        name = d.pop("name")

        _kind = d.pop("kind", UNSET)
        kind: PostApiSuitesBodyKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = PostApiSuitesBodyKind(_kind)

        description = d.pop("description", UNSET)

        scenario_ids = cast(list[str], d.pop("scenarioIds", UNSET))

        def _parse_scope(
            data: object,
        ) -> (
            PostApiSuitesBodyScopeType0
            | PostApiSuitesBodyScopeType1
            | PostApiSuitesBodyScopeType2
            | PostApiSuitesBodyScopeType3
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_0 = PostApiSuitesBodyScopeType0.from_dict(data)

                return scope_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_1 = PostApiSuitesBodyScopeType1.from_dict(data)

                return scope_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_2 = PostApiSuitesBodyScopeType2.from_dict(data)

                return scope_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            scope_type_3 = PostApiSuitesBodyScopeType3.from_dict(data)

            return scope_type_3

        scope = _parse_scope(d.pop("scope", UNSET))

        _targets = d.pop("targets", UNSET)
        targets: list[PostApiSuitesBodyTargetsItem] | Unset = UNSET
        if _targets is not UNSET:
            targets = []
            for targets_item_data in _targets:
                targets_item = PostApiSuitesBodyTargetsItem.from_dict(targets_item_data)

                targets.append(targets_item)

        repeat_count = d.pop("repeatCount", UNSET)

        labels = cast(list[str], d.pop("labels", UNSET))

        post_api_suites_body = cls(
            name=name,
            kind=kind,
            description=description,
            scenario_ids=scenario_ids,
            scope=scope,
            targets=targets,
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
