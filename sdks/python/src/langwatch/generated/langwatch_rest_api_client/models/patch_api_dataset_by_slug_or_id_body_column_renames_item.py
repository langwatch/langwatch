from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PatchApiDatasetBySlugOrIdBodyColumnRenamesItem")


@_attrs_define
class PatchApiDatasetBySlugOrIdBodyColumnRenamesItem:
    """
    Attributes:
        from_ (str):
        to (str):
    """

    from_: str
    to: str

    def to_dict(self) -> dict[str, Any]:
        from_ = self.from_

        to = self.to

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "from": from_,
                "to": to,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        from_ = d.pop("from")

        to = d.pop("to")

        patch_api_dataset_by_slug_or_id_body_column_renames_item = cls(
            from_=from_,
            to=to,
        )

        return patch_api_dataset_by_slug_or_id_body_column_renames_item
