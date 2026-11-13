from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetStaffAccessQueueSummaryResponse200QueuesItem")


@_attrs_define
class GetStaffAccessQueueSummaryResponse200QueuesItem:
    """
    Attributes:
        name (str):
        display_name (str):
        pending_group_count (float):
        blocked_group_count (float):
        active_group_count (float):
        parked_group_count (float):
        total_pending_jobs (float):
        dlq_count (float):
    """

    name: str
    display_name: str
    pending_group_count: float
    blocked_group_count: float
    active_group_count: float
    parked_group_count: float
    total_pending_jobs: float
    dlq_count: float

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        display_name = self.display_name

        pending_group_count = self.pending_group_count

        blocked_group_count = self.blocked_group_count

        active_group_count = self.active_group_count

        parked_group_count = self.parked_group_count

        total_pending_jobs = self.total_pending_jobs

        dlq_count = self.dlq_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "displayName": display_name,
                "pendingGroupCount": pending_group_count,
                "blockedGroupCount": blocked_group_count,
                "activeGroupCount": active_group_count,
                "parkedGroupCount": parked_group_count,
                "totalPendingJobs": total_pending_jobs,
                "dlqCount": dlq_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        display_name = d.pop("displayName")

        pending_group_count = d.pop("pendingGroupCount")

        blocked_group_count = d.pop("blockedGroupCount")

        active_group_count = d.pop("activeGroupCount")

        parked_group_count = d.pop("parkedGroupCount")

        total_pending_jobs = d.pop("totalPendingJobs")

        dlq_count = d.pop("dlqCount")

        get_staff_access_queue_summary_response_200_queues_item = cls(
            name=name,
            display_name=display_name,
            pending_group_count=pending_group_count,
            blocked_group_count=blocked_group_count,
            active_group_count=active_group_count,
            parked_group_count=parked_group_count,
            total_pending_jobs=total_pending_jobs,
            dlq_count=dlq_count,
        )

        return get_staff_access_queue_summary_response_200_queues_item
