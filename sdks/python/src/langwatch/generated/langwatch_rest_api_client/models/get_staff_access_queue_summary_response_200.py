from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_staff_access_queue_summary_response_200_queues_item import (
        GetStaffAccessQueueSummaryResponse200QueuesItem,
    )


T = TypeVar("T", bound="GetStaffAccessQueueSummaryResponse200")


@_attrs_define
class GetStaffAccessQueueSummaryResponse200:
    """
    Attributes:
        queues (list[GetStaffAccessQueueSummaryResponse200QueuesItem]):
    """

    queues: list[GetStaffAccessQueueSummaryResponse200QueuesItem]

    def to_dict(self) -> dict[str, Any]:
        queues = []
        for queues_item_data in self.queues:
            queues_item = queues_item_data.to_dict()
            queues.append(queues_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "queues": queues,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_staff_access_queue_summary_response_200_queues_item import (
            GetStaffAccessQueueSummaryResponse200QueuesItem,
        )

        d = dict(src_dict)
        queues = []
        _queues = d.pop("queues")
        for queues_item_data in _queues:
            queues_item = GetStaffAccessQueueSummaryResponse200QueuesItem.from_dict(queues_item_data)

            queues.append(queues_item)

        get_staff_access_queue_summary_response_200 = cls(
            queues=queues,
        )

        return get_staff_access_queue_summary_response_200
