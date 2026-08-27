from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_suites_response_200_item_kind import GetApiSuitesResponse200ItemKind

if TYPE_CHECKING:
    from ..models.get_api_suites_response_200_item_scope_type_0 import GetApiSuitesResponse200ItemScopeType0
    from ..models.get_api_suites_response_200_item_scope_type_1 import GetApiSuitesResponse200ItemScopeType1
    from ..models.get_api_suites_response_200_item_scope_type_2 import GetApiSuitesResponse200ItemScopeType2
    from ..models.get_api_suites_response_200_item_scope_type_3 import GetApiSuitesResponse200ItemScopeType3
    from ..models.get_api_suites_response_200_item_targets_item import GetApiSuitesResponse200ItemTargetsItem


T = TypeVar("T", bound="GetApiSuitesResponse200Item")


@_attrs_define
class GetApiSuitesResponse200Item:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        kind (GetApiSuitesResponse200ItemKind): custom is a hand-assembled run plan; folder is a test suite that groups
            scenarios filed into it.
        description (None | str):
        scenario_ids (list[str]):
        scope (GetApiSuitesResponse200ItemScopeType0 | GetApiSuitesResponse200ItemScopeType1 |
            GetApiSuitesResponse200ItemScopeType2 | GetApiSuitesResponse200ItemScopeType3 | None): What the run plan covers:
            all (every active scenario), folders (the cases filed in the named test suites), labels (the cases carrying any
            of the labels), or cases (the scenarioIds below). A dynamic scope is resolved again at every run, so a scenario
            written later runs without editing the plan.
        targets (list[GetApiSuitesResponse200ItemTargetsItem]):
        repeat_count (float):
        labels (list[str]):
        created_at (str):
        updated_at (str):
        platform_url (str):
    """

    id: str
    name: str
    slug: str
    kind: GetApiSuitesResponse200ItemKind
    description: None | str
    scenario_ids: list[str]
    scope: (
        GetApiSuitesResponse200ItemScopeType0
        | GetApiSuitesResponse200ItemScopeType1
        | GetApiSuitesResponse200ItemScopeType2
        | GetApiSuitesResponse200ItemScopeType3
        | None
    )
    targets: list[GetApiSuitesResponse200ItemTargetsItem]
    repeat_count: float
    labels: list[str]
    created_at: str
    updated_at: str
    platform_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_suites_response_200_item_scope_type_0 import GetApiSuitesResponse200ItemScopeType0
        from ..models.get_api_suites_response_200_item_scope_type_1 import GetApiSuitesResponse200ItemScopeType1
        from ..models.get_api_suites_response_200_item_scope_type_2 import GetApiSuitesResponse200ItemScopeType2
        from ..models.get_api_suites_response_200_item_scope_type_3 import GetApiSuitesResponse200ItemScopeType3

        id = self.id

        name = self.name

        slug = self.slug

        kind = self.kind.value

        description: None | str
        description = self.description

        scenario_ids = self.scenario_ids

        scope: dict[str, Any] | None
        if isinstance(self.scope, GetApiSuitesResponse200ItemScopeType0):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, GetApiSuitesResponse200ItemScopeType1):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, GetApiSuitesResponse200ItemScopeType2):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, GetApiSuitesResponse200ItemScopeType3):
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
        from ..models.get_api_suites_response_200_item_scope_type_0 import GetApiSuitesResponse200ItemScopeType0
        from ..models.get_api_suites_response_200_item_scope_type_1 import GetApiSuitesResponse200ItemScopeType1
        from ..models.get_api_suites_response_200_item_scope_type_2 import GetApiSuitesResponse200ItemScopeType2
        from ..models.get_api_suites_response_200_item_scope_type_3 import GetApiSuitesResponse200ItemScopeType3
        from ..models.get_api_suites_response_200_item_targets_item import GetApiSuitesResponse200ItemTargetsItem

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        kind = GetApiSuitesResponse200ItemKind(d.pop("kind"))

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        scenario_ids = cast(list[str], d.pop("scenarioIds"))

        def _parse_scope(
            data: object,
        ) -> (
            GetApiSuitesResponse200ItemScopeType0
            | GetApiSuitesResponse200ItemScopeType1
            | GetApiSuitesResponse200ItemScopeType2
            | GetApiSuitesResponse200ItemScopeType3
            | None
        ):
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_0 = GetApiSuitesResponse200ItemScopeType0.from_dict(data)

                return scope_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_1 = GetApiSuitesResponse200ItemScopeType1.from_dict(data)

                return scope_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_2 = GetApiSuitesResponse200ItemScopeType2.from_dict(data)

                return scope_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_3 = GetApiSuitesResponse200ItemScopeType3.from_dict(data)

                return scope_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetApiSuitesResponse200ItemScopeType0
                | GetApiSuitesResponse200ItemScopeType1
                | GetApiSuitesResponse200ItemScopeType2
                | GetApiSuitesResponse200ItemScopeType3
                | None,
                data,
            )

        scope = _parse_scope(d.pop("scope"))

        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = GetApiSuitesResponse200ItemTargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

        repeat_count = d.pop("repeatCount")

        labels = cast(list[str], d.pop("labels"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        get_api_suites_response_200_item = cls(
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

        get_api_suites_response_200_item.additional_properties = d
        return get_api_suites_response_200_item

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
