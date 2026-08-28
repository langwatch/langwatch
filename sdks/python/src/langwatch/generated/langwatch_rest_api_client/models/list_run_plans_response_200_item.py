from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.list_run_plans_response_200_item_scope_type_0 import ListRunPlansResponse200ItemScopeType0
    from ..models.list_run_plans_response_200_item_scope_type_1 import ListRunPlansResponse200ItemScopeType1
    from ..models.list_run_plans_response_200_item_scope_type_2 import ListRunPlansResponse200ItemScopeType2
    from ..models.list_run_plans_response_200_item_scope_type_3 import ListRunPlansResponse200ItemScopeType3
    from ..models.list_run_plans_response_200_item_targets_item import ListRunPlansResponse200ItemTargetsItem


T = TypeVar("T", bound="ListRunPlansResponse200Item")


@_attrs_define
class ListRunPlansResponse200Item:
    """
    Attributes:
        id (str): The run plan id.
        name (str): The run plan name. This is the plan's identity: a run started under this name joins this plan.
        slug (str): The plan's address in the platform. It is kept when the plan is renamed, so run history never moves.
        scope (ListRunPlansResponse200ItemScopeType0 | ListRunPlansResponse200ItemScopeType1 |
            ListRunPlansResponse200ItemScopeType2 | ListRunPlansResponse200ItemScopeType3): What the run plan covers: all
            (every active scenario), test_suites (the scenarios filed in the named test suites), labels (the scenarios
            carrying any of the labels), or scenarios (the scenarioIds sent with the configuration). A dynamic scope is
            resolved again at every run, so a scenario written later runs without editing the plan.
        scenario_ids (list[str]): The scenarios the last run of this plan covered.
        targets (list[ListRunPlansResponse200ItemTargetsItem]): What the plan runs against, in the order the results
            show.
        repeat_count (float): How many times each scenario and target pairing runs.
        simulator_model (None | str): The model that plays the user, or null for the scenario or project default.
        judge_model (None | str): The model that judges the run, or null for the scenario or project default.
        labels (list[str]): The labels the plan carries.
        archived_at (None | str): When the plan was archived, or null while it is active.
        created_at (str): When the plan was created.
        updated_at (str): When the plan was last written.
        platform_url (str): Where to open this run plan in the LangWatch platform.
    """

    id: str
    name: str
    slug: str
    scope: (
        ListRunPlansResponse200ItemScopeType0
        | ListRunPlansResponse200ItemScopeType1
        | ListRunPlansResponse200ItemScopeType2
        | ListRunPlansResponse200ItemScopeType3
    )
    scenario_ids: list[str]
    targets: list[ListRunPlansResponse200ItemTargetsItem]
    repeat_count: float
    simulator_model: None | str
    judge_model: None | str
    labels: list[str]
    archived_at: None | str
    created_at: str
    updated_at: str
    platform_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.list_run_plans_response_200_item_scope_type_0 import ListRunPlansResponse200ItemScopeType0
        from ..models.list_run_plans_response_200_item_scope_type_1 import ListRunPlansResponse200ItemScopeType1
        from ..models.list_run_plans_response_200_item_scope_type_2 import ListRunPlansResponse200ItemScopeType2

        id = self.id

        name = self.name

        slug = self.slug

        scope: dict[str, Any]
        if isinstance(self.scope, ListRunPlansResponse200ItemScopeType0):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, ListRunPlansResponse200ItemScopeType1):
            scope = self.scope.to_dict()
        elif isinstance(self.scope, ListRunPlansResponse200ItemScopeType2):
            scope = self.scope.to_dict()
        else:
            scope = self.scope.to_dict()

        scenario_ids = self.scenario_ids

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)

        repeat_count = self.repeat_count

        simulator_model: None | str
        simulator_model = self.simulator_model

        judge_model: None | str
        judge_model = self.judge_model

        labels = self.labels

        archived_at: None | str
        archived_at = self.archived_at

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
                "scope": scope,
                "scenarioIds": scenario_ids,
                "targets": targets,
                "repeatCount": repeat_count,
                "simulatorModel": simulator_model,
                "judgeModel": judge_model,
                "labels": labels,
                "archivedAt": archived_at,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_run_plans_response_200_item_scope_type_0 import ListRunPlansResponse200ItemScopeType0
        from ..models.list_run_plans_response_200_item_scope_type_1 import ListRunPlansResponse200ItemScopeType1
        from ..models.list_run_plans_response_200_item_scope_type_2 import ListRunPlansResponse200ItemScopeType2
        from ..models.list_run_plans_response_200_item_scope_type_3 import ListRunPlansResponse200ItemScopeType3
        from ..models.list_run_plans_response_200_item_targets_item import ListRunPlansResponse200ItemTargetsItem

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        def _parse_scope(
            data: object,
        ) -> (
            ListRunPlansResponse200ItemScopeType0
            | ListRunPlansResponse200ItemScopeType1
            | ListRunPlansResponse200ItemScopeType2
            | ListRunPlansResponse200ItemScopeType3
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_0 = ListRunPlansResponse200ItemScopeType0.from_dict(data)

                return scope_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_1 = ListRunPlansResponse200ItemScopeType1.from_dict(data)

                return scope_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                scope_type_2 = ListRunPlansResponse200ItemScopeType2.from_dict(data)

                return scope_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            scope_type_3 = ListRunPlansResponse200ItemScopeType3.from_dict(data)

            return scope_type_3

        scope = _parse_scope(d.pop("scope"))

        scenario_ids = cast(list[str], d.pop("scenarioIds"))

        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = ListRunPlansResponse200ItemTargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

        repeat_count = d.pop("repeatCount")

        def _parse_simulator_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        simulator_model = _parse_simulator_model(d.pop("simulatorModel"))

        def _parse_judge_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        judge_model = _parse_judge_model(d.pop("judgeModel"))

        labels = cast(list[str], d.pop("labels"))

        def _parse_archived_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        list_run_plans_response_200_item = cls(
            id=id,
            name=name,
            slug=slug,
            scope=scope,
            scenario_ids=scenario_ids,
            targets=targets,
            repeat_count=repeat_count,
            simulator_model=simulator_model,
            judge_model=judge_model,
            labels=labels,
            archived_at=archived_at,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        list_run_plans_response_200_item.additional_properties = d
        return list_run_plans_response_200_item

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
