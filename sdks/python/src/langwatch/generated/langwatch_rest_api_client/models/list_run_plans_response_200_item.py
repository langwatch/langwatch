from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.list_run_plans_response_200_item_evaluators_item import ListRunPlansResponse200ItemEvaluatorsItem
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
            show. A target carrying runParameters runs with those values.
        repeat_count (float): How many times each scenario and target pairing runs.
        simulator_model (None | str): The model that plays the user, or null for the scenario or project default.
        judge_model (None | str): The model that judges the run, or null for the scenario or project default.
        labels (list[str]): The labels the plan carries.
        archived_at (None | str): When the plan was archived, or null while it is active.
        created_at (str): When the plan was created.
        updated_at (str): When the plan was last written.
        platform_url (str): Where to open this run plan in the LangWatch platform.
        trace_quiet_period_ms (int | None | Unset): Milliseconds the agent's trace must stay unchanged before the judge
            reads it, or null for the scenario setting or the project's recommendation. Absent on servers that predate judge
            trace settings.
        trace_wait_timeout_ms (int | None | Unset): Milliseconds the judge waits for the agent's trace before a verdict,
            or null for the scenario setting or the project's recommendation. Absent on servers that predate judge trace
            settings.
        evaluators (list[ListRunPlansResponse200ItemEvaluatorsItem] | Unset): The plan's own evaluators. Absent on
            servers that predate evaluators on this family.
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
    trace_quiet_period_ms: int | None | Unset = UNSET
    trace_wait_timeout_ms: int | None | Unset = UNSET
    evaluators: list[ListRunPlansResponse200ItemEvaluatorsItem] | Unset = UNSET

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

        trace_quiet_period_ms: int | None | Unset
        if isinstance(self.trace_quiet_period_ms, Unset):
            trace_quiet_period_ms = UNSET
        else:
            trace_quiet_period_ms = self.trace_quiet_period_ms

        trace_wait_timeout_ms: int | None | Unset
        if isinstance(self.trace_wait_timeout_ms, Unset):
            trace_wait_timeout_ms = UNSET
        else:
            trace_wait_timeout_ms = self.trace_wait_timeout_ms

        evaluators: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluators, Unset):
            evaluators = []
            for evaluators_item_data in self.evaluators:
                evaluators_item = evaluators_item_data.to_dict()
                evaluators.append(evaluators_item)

        field_dict: dict[str, Any] = {}

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
        if trace_quiet_period_ms is not UNSET:
            field_dict["traceQuietPeriodMs"] = trace_quiet_period_ms
        if trace_wait_timeout_ms is not UNSET:
            field_dict["traceWaitTimeoutMs"] = trace_wait_timeout_ms
        if evaluators is not UNSET:
            field_dict["evaluators"] = evaluators

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_run_plans_response_200_item_evaluators_item import ListRunPlansResponse200ItemEvaluatorsItem
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

        def _parse_trace_quiet_period_ms(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        trace_quiet_period_ms = _parse_trace_quiet_period_ms(d.pop("traceQuietPeriodMs", UNSET))

        def _parse_trace_wait_timeout_ms(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        trace_wait_timeout_ms = _parse_trace_wait_timeout_ms(d.pop("traceWaitTimeoutMs", UNSET))

        _evaluators = d.pop("evaluators", UNSET)
        evaluators: list[ListRunPlansResponse200ItemEvaluatorsItem] | Unset = UNSET
        if _evaluators is not UNSET:
            evaluators = []
            for evaluators_item_data in _evaluators:
                evaluators_item = ListRunPlansResponse200ItemEvaluatorsItem.from_dict(evaluators_item_data)

                evaluators.append(evaluators_item)

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
            trace_quiet_period_ms=trace_quiet_period_ms,
            trace_wait_timeout_ms=trace_wait_timeout_ms,
            evaluators=evaluators,
        )

        return list_run_plans_response_200_item
