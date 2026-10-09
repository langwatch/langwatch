from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.sample_instant_eval_run_response_200_judgments_item import (
        SampleInstantEvalRunResponse200JudgmentsItem,
    )
    from ..models.sample_instant_eval_run_response_200_rows_item import SampleInstantEvalRunResponse200RowsItem


T = TypeVar("T", bound="SampleInstantEvalRunResponse200")


@_attrs_define
class SampleInstantEvalRunResponse200:
    """
    Attributes:
        rows (list[SampleInstantEvalRunResponse200RowsItem]): The statement's own rows, with each judged column holding
            the text that was judged rather than the verdict.
        judgments (list[SampleInstantEvalRunResponse200JudgmentsItem]): The verdicts those rows received.
    """

    rows: list[SampleInstantEvalRunResponse200RowsItem]
    judgments: list[SampleInstantEvalRunResponse200JudgmentsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        judgments = []
        for judgments_item_data in self.judgments:
            judgments_item = judgments_item_data.to_dict()
            judgments.append(judgments_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "rows": rows,
                "judgments": judgments,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sample_instant_eval_run_response_200_judgments_item import (
            SampleInstantEvalRunResponse200JudgmentsItem,
        )
        from ..models.sample_instant_eval_run_response_200_rows_item import SampleInstantEvalRunResponse200RowsItem

        d = dict(src_dict)
        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = SampleInstantEvalRunResponse200RowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        judgments = []
        _judgments = d.pop("judgments")
        for judgments_item_data in _judgments:
            judgments_item = SampleInstantEvalRunResponse200JudgmentsItem.from_dict(judgments_item_data)

            judgments.append(judgments_item)

        sample_instant_eval_run_response_200 = cls(
            rows=rows,
            judgments=judgments,
        )

        sample_instant_eval_run_response_200.additional_properties = d
        return sample_instant_eval_run_response_200

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
