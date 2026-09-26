from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_suites_by_id_run_response_200_items_item import PostApiSuitesByIdRunResponse200ItemsItem
    from ..models.post_api_suites_by_id_run_response_200_skipped_archived import (
        PostApiSuitesByIdRunResponse200SkippedArchived,
    )


T = TypeVar("T", bound="PostApiSuitesByIdRunResponse200")


@_attrs_define
class PostApiSuitesByIdRunResponse200:
    """
    Attributes:
        scheduled (bool):
        batch_run_id (str):
        set_id (str):
        job_count (float):
        skipped_archived (PostApiSuitesByIdRunResponse200SkippedArchived):
        items (list[PostApiSuitesByIdRunResponse200ItemsItem]):
        plan_name (str | Unset):
        created (bool | Unset):
    """

    scheduled: bool
    batch_run_id: str
    set_id: str
    job_count: float
    skipped_archived: PostApiSuitesByIdRunResponse200SkippedArchived
    items: list[PostApiSuitesByIdRunResponse200ItemsItem]
    plan_name: str | Unset = UNSET
    created: bool | Unset = UNSET
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

        plan_name = self.plan_name

        created = self.created

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
            }
        )
        if plan_name is not UNSET:
            field_dict["planName"] = plan_name
        if created is not UNSET:
            field_dict["created"] = created

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_suites_by_id_run_response_200_items_item import PostApiSuitesByIdRunResponse200ItemsItem
        from ..models.post_api_suites_by_id_run_response_200_skipped_archived import (
            PostApiSuitesByIdRunResponse200SkippedArchived,
        )

        d = dict(src_dict)
        scheduled = d.pop("scheduled")

        batch_run_id = d.pop("batchRunId")

        set_id = d.pop("setId")

        job_count = d.pop("jobCount")

        skipped_archived = PostApiSuitesByIdRunResponse200SkippedArchived.from_dict(d.pop("skippedArchived"))

        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = PostApiSuitesByIdRunResponse200ItemsItem.from_dict(items_item_data)

            items.append(items_item)

        plan_name = d.pop("planName", UNSET)

        created = d.pop("created", UNSET)

        post_api_suites_by_id_run_response_200 = cls(
            scheduled=scheduled,
            batch_run_id=batch_run_id,
            set_id=set_id,
            job_count=job_count,
            skipped_archived=skipped_archived,
            items=items,
            plan_name=plan_name,
            created=created,
        )

        post_api_suites_by_id_run_response_200.additional_properties = d
        return post_api_suites_by_id_run_response_200

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
