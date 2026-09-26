from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.post_api_checkup_run_response_200_rows_item import PostApiCheckupRunResponse200RowsItem


T = TypeVar("T", bound="PostApiCheckupRunResponse200")


@_attrs_define
class PostApiCheckupRunResponse200:
    """
    Attributes:
        ran_at (datetime.datetime):
        rows (list[PostApiCheckupRunResponse200RowsItem]):
    """

    ran_at: datetime.datetime
    rows: list[PostApiCheckupRunResponse200RowsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ran_at = self.ran_at.isoformat()

        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        ran_at = isoparse(d.pop("ranAt"))

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = PostApiCheckupRunResponse200RowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        post_api_checkup_run_response_200 = cls(
            ran_at=ran_at,
            rows=rows,
        )

        post_api_checkup_run_response_200.additional_properties = d
        return post_api_checkup_run_response_200

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
