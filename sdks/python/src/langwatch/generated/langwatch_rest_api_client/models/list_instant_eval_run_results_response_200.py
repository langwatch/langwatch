from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        judgments = []
        for judgments_item_data in self.judgments:
            judgments_item = judgments_item_data.to_dict()
            judgments.append(judgments_item)

        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        list_instant_eval_run_results_response_200.additional_properties = d
        return list_instant_eval_run_results_response_200

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
