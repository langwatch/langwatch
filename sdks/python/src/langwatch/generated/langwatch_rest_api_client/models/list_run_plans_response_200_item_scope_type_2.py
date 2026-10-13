from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ListRunPlansResponse200ItemScopeType2")


@_attrs_define
class ListRunPlansResponse200ItemScopeType2:
    """
    Attributes:
        mode (Literal['labels']):
        labels (list[str]):
    """

    mode: Literal["labels"]
    labels: list[str]

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode

        labels = self.labels

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "mode": mode,
                "labels": labels,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        mode = cast(Literal["labels"], d.pop("mode"))
        if mode != "labels":
            raise ValueError(f"mode must match const 'labels', got '{mode}'")

        labels = cast(list[str], d.pop("labels"))

        list_run_plans_response_200_item_scope_type_2 = cls(
            mode=mode,
            labels=labels,
        )

        return list_run_plans_response_200_item_scope_type_2
