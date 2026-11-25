from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_checkup_run_response_200_rows_item import PostApiCheckupRunResponse200RowsItem


T = TypeVar("T", bound="PostApiCheckupRunResponse200")


@_attrs_define
class PostApiCheckupRunResponse200:
    """
    Attributes:
        ran_at (str):
        rows (list[PostApiCheckupRunResponse200RowsItem]):
    """

    ran_at: str
    rows: list[PostApiCheckupRunResponse200RowsItem]

    def to_dict(self) -> dict[str, Any]:
        ran_at = self.ran_at

        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ranAt": ran_at,
                "rows": rows,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_checkup_run_response_200_rows_item import PostApiCheckupRunResponse200RowsItem

        d = dict(src_dict)
        ran_at = d.pop("ranAt")

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = PostApiCheckupRunResponse200RowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        post_api_checkup_run_response_200 = cls(
            ran_at=ran_at,
            rows=rows,
        )

        return post_api_checkup_run_response_200
