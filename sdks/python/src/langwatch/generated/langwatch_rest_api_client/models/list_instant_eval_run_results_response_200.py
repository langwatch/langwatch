from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.list_instant_eval_run_results_response_200_judgments_item import (
        ListInstantEvalRunResultsResponse200JudgmentsItem,
    )


T = TypeVar("T", bound="ListInstantEvalRunResultsResponse200")


@_attrs_define
class ListInstantEvalRunResultsResponse200:
    """
    Attributes:
        judgments (list[ListInstantEvalRunResultsResponse200JudgmentsItem]): One page of the run's judgements.
        next_cursor (str | Unset): Pass as cursor to read the page after this one. Absent on the last page.
    """

    judgments: list[ListInstantEvalRunResultsResponse200JudgmentsItem]
    next_cursor: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        judgments = []
        for judgments_item_data in self.judgments:
            judgments_item = judgments_item_data.to_dict()
            judgments.append(judgments_item)

        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "judgments": judgments,
            }
        )
        if next_cursor is not UNSET:
            field_dict["nextCursor"] = next_cursor

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_instant_eval_run_results_response_200_judgments_item import (
            ListInstantEvalRunResultsResponse200JudgmentsItem,
        )

        d = dict(src_dict)
        judgments = []
        _judgments = d.pop("judgments")
        for judgments_item_data in _judgments:
            judgments_item = ListInstantEvalRunResultsResponse200JudgmentsItem.from_dict(judgments_item_data)

            judgments.append(judgments_item)

        next_cursor = d.pop("nextCursor", UNSET)

        list_instant_eval_run_results_response_200 = cls(
            judgments=judgments,
            next_cursor=next_cursor,
        )

        return list_instant_eval_run_results_response_200
