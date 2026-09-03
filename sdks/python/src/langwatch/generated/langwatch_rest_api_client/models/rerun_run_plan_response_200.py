from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.rerun_run_plan_response_200_items_item import RerunRunPlanResponse200ItemsItem
    from ..models.rerun_run_plan_response_200_skipped_archived import RerunRunPlanResponse200SkippedArchived


T = TypeVar("T", bound="RerunRunPlanResponse200")


@_attrs_define
class RerunRunPlanResponse200:
    """
    Attributes:
        scheduled (bool): True once the runs are queued.
        batch_run_id (str): The id of this batch. Every run started here carries it.
        set_id (str): The result set the batch is filed under in the platform.
        job_count (float): How many runs were queued.
        skipped_archived (RerunRunPlanResponse200SkippedArchived): What the run left out, and why.
        items (list[RerunRunPlanResponse200ItemsItem]): Every run this call queued.
        run_plan_id (str): The run plan this run was filed under.
        plan_name (str): The name that plan answers to.
        created (bool): True when this run created the plan, false when it joined a plan already there.
        platform_url (str): Where to watch this run in the LangWatch platform.
    """

    scheduled: bool
    batch_run_id: str
    set_id: str
    job_count: float
    skipped_archived: RerunRunPlanResponse200SkippedArchived
    items: list[RerunRunPlanResponse200ItemsItem]
    run_plan_id: str
    plan_name: str
    created: bool
    platform_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scheduled = self.scheduled

        batch_run_id = self.batch_run_id

        set_id = self.set_id

        job_count = self.job_count

        skipped_archived = self.skipped_archived.to_dict()

        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        run_plan_id = self.run_plan_id

        plan_name = self.plan_name

        created = self.created

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scheduled": scheduled,
                "batchRunId": batch_run_id,
                "setId": set_id,
                "jobCount": job_count,
                "skippedArchived": skipped_archived,
                "items": items,
                "runPlanId": run_plan_id,
                "planName": plan_name,
                "created": created,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.rerun_run_plan_response_200_items_item import RerunRunPlanResponse200ItemsItem
        from ..models.rerun_run_plan_response_200_skipped_archived import RerunRunPlanResponse200SkippedArchived

        d = dict(src_dict)
        scheduled = d.pop("scheduled")

        batch_run_id = d.pop("batchRunId")

        set_id = d.pop("setId")

        job_count = d.pop("jobCount")

        skipped_archived = RerunRunPlanResponse200SkippedArchived.from_dict(d.pop("skippedArchived"))

        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = RerunRunPlanResponse200ItemsItem.from_dict(items_item_data)

            items.append(items_item)

        run_plan_id = d.pop("runPlanId")

        plan_name = d.pop("planName")

        created = d.pop("created")

        platform_url = d.pop("platformUrl")

        rerun_run_plan_response_200 = cls(
            scheduled=scheduled,
            batch_run_id=batch_run_id,
            set_id=set_id,
            job_count=job_count,
            skipped_archived=skipped_archived,
            items=items,
            run_plan_id=run_plan_id,
            plan_name=plan_name,
            created=created,
            platform_url=platform_url,
        )

        rerun_run_plan_response_200.additional_properties = d
        return rerun_run_plan_response_200

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
