from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_checkup_response_200_rows_item import GetApiCheckupResponse200RowsItem
    from ..models.get_api_checkup_response_200_usage_report import GetApiCheckupResponse200UsageReport


T = TypeVar("T", bound="GetApiCheckupResponse200")


@_attrs_define
class GetApiCheckupResponse200:
    """
    Attributes:
        ran_at (str):
        rows (list[GetApiCheckupResponse200RowsItem]):
        usage_report (GetApiCheckupResponse200UsageReport):
    """

    ran_at: str
    rows: list[GetApiCheckupResponse200RowsItem]
    usage_report: GetApiCheckupResponse200UsageReport

    def to_dict(self) -> dict[str, Any]:
        ran_at = self.ran_at

        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        usage_report = self.usage_report.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ranAt": ran_at,
                "rows": rows,
                "usageReport": usage_report,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_checkup_response_200_rows_item import GetApiCheckupResponse200RowsItem
        from ..models.get_api_checkup_response_200_usage_report import GetApiCheckupResponse200UsageReport

        d = dict(src_dict)
        ran_at = d.pop("ranAt")

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = GetApiCheckupResponse200RowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        usage_report = GetApiCheckupResponse200UsageReport.from_dict(d.pop("usageReport"))

        get_api_checkup_response_200 = cls(
            ran_at=ran_at,
            rows=rows,
            usage_report=usage_report,
        )

        return get_api_checkup_response_200
