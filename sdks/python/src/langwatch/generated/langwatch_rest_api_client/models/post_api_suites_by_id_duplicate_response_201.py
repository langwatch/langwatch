from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_suites_by_id_duplicate_response_201_kind import PostApiSuitesByIdDuplicateResponse201Kind

if TYPE_CHECKING:
    from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_0 import (
        PostApiSuitesByIdDuplicateResponse201ScopeType0,
    )
    from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_1 import (
        PostApiSuitesByIdDuplicateResponse201ScopeType1,
    )
    from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_2 import (
        PostApiSuitesByIdDuplicateResponse201ScopeType2,
    )
    from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_3 import (
        PostApiSuitesByIdDuplicateResponse201ScopeType3,
    )
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
        kind (PostApiSuitesByIdDuplicateResponse201Kind): custom is a hand-assembled run plan; folder is a test suite
            that groups scenarios filed into it.
        description (None | str):
        scenario_ids (list[str]):
        scope (None | PostApiSuitesByIdDuplicateResponse201ScopeType0 | PostApiSuitesByIdDuplicateResponse201ScopeType1
            | PostApiSuitesByIdDuplicateResponse201ScopeType2 | PostApiSuitesByIdDuplicateResponse201ScopeType3): What the
            run plan covers: all (every active scenario), folders (the cases filed in the named test suites), labels (the
            cases carrying any of the labels), or cases (the scenarioIds below). A dynamic scope is resolved again at every
            run, so a scenario written later runs without editing the plan.
        targets (list[PostApiSuitesByIdDuplicateResponse201TargetsItem]):
        repeat_count (float):
        labels (list[str]):
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    slug: str
    kind: PostApiSuitesByIdDuplicateResponse201Kind
    description: None | str
    scenario_ids: list[str]
    scope: (
        None
        | PostApiSuitesByIdDuplicateResponse201ScopeType0
        | PostApiSuitesByIdDuplicateResponse201ScopeType1
        | PostApiSuitesByIdDuplicateResponse201ScopeType2
        | PostApiSuitesByIdDuplicateResponse201ScopeType3
    )
    targets: list[PostApiSuitesByIdDuplicateResponse201TargetsItem]
    repeat_count: float
    labels: list[str]
    created_at: str
    updated_at: str
    platform_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_0 import (
            PostApiSuitesByIdDuplicateResponse201ScopeType0,
        )
        from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_1 import (
            PostApiSuitesByIdDuplicateResponse201ScopeType1,
        )
        from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_2 import (
            PostApiSuitesByIdDuplicateResponse201ScopeType2,
        )
        from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_3 import (
            PostApiSuitesByIdDuplicateResponse201ScopeType3,
        )

        id = self.id

        name = self.name

        slug = self.slug

        kind = self.kind.value

        description: None | str
        description = self.description

        scenario_ids = self.scenario_ids

        scope: dict[str, Any] | None
        if isinstance(self.scope, PostApiSuitesByIdDuplicateResponse201ScopeType0):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiSuitesByIdDuplicateResponse201ScopeType1):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiSuitesByIdDuplicateResponse201ScopeType2):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, PostApiSuitesByIdDuplicateResponse201ScopeType3):
            scope = self.scope.to_dict()
        else:
            scope = self.scope

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)

        repeat_count = self.repeat_count

        labels = self.labels

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "kind": kind,
                "description": description,
                "scenarioIds": scenario_ids,
                "scope": scope,
                "targets": targets,
                "repeatCount": repeat_count,
                "labels": labels,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_0 import (
            PostApiSuitesByIdDuplicateResponse201ScopeType0,
        )
        from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_1 import (
            PostApiSuitesByIdDuplicateResponse201ScopeType1,
        )
        from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_2 import (
            PostApiSuitesByIdDuplicateResponse201ScopeType2,
        )
        from ..models.post_api_suites_by_id_duplicate_response_201_scope_type_3 import (
            PostApiSuitesByIdDuplicateResponse201ScopeType3,
        )
        from ..models.post_api_suites_by_id_duplicate_response_201_targets_item import (
            PostApiSuitesByIdDuplicateResponse201TargetsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        kind = PostApiSuitesByIdDuplicateResponse201Kind(d.pop("kind"))

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        scenario_ids = cast(list[str], d.pop("scenarioIds"))

        def _parse_scope(
            data: object,
        ) -> (
            None
            | PostApiSuitesByIdDuplicateResponse201ScopeType0
            | PostApiSuitesByIdDuplicateResponse201ScopeType1
            | PostApiSuitesByIdDuplicateResponse201ScopeType2
            | PostApiSuitesByIdDuplicateResponse201ScopeType3
        ):
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_0 = PostApiSuitesByIdDuplicateResponse201ScopeType0.from_dict(data)

                return scope_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_1 = PostApiSuitesByIdDuplicateResponse201ScopeType1.from_dict(data)

                return scope_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_2 = PostApiSuitesByIdDuplicateResponse201ScopeType2.from_dict(data)

                return scope_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_3 = PostApiSuitesByIdDuplicateResponse201ScopeType3.from_dict(data)

                return scope_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | PostApiSuitesByIdDuplicateResponse201ScopeType0
                | PostApiSuitesByIdDuplicateResponse201ScopeType1
                | PostApiSuitesByIdDuplicateResponse201ScopeType2
                | PostApiSuitesByIdDuplicateResponse201ScopeType3,
                data,
            )

        scope = _parse_scope(d.pop("scope"))

        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = PostApiSuitesByIdDuplicateResponse201TargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

        repeat_count = d.pop("repeatCount")

        labels = cast(list[str], d.pop("labels"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        post_api_suites_by_id_duplicate_response_201 = cls(
            id=id,
            name=name,
            slug=slug,
            kind=kind,
            description=description,
            scenario_ids=scenario_ids,
            scope=scope,
            targets=targets,
            repeat_count=repeat_count,
            labels=labels,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
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
