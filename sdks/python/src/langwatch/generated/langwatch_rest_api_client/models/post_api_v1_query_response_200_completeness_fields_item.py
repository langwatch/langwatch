from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiV1QueryResponse200CompletenessFieldsItem")


@_attrs_define
class PostApiV1QueryResponse200CompletenessFieldsItem:
    """
    Attributes:
        field (str):
        label (str):
        present (float):
    """

    field: str
    label: str
    present: float

    def to_dict(self) -> dict[str, Any]:
        field = self.field

        label = self.label

        present = self.present

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "field": field,
                "label": label,
                "present": present,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field = d.pop("field")

        label = d.pop("label")

        present = d.pop("present")

        post_api_v1_query_response_200_completeness_fields_item = cls(
            field=field,
            label=label,
            present=present,
        )

        return post_api_v1_query_response_200_completeness_fields_item
