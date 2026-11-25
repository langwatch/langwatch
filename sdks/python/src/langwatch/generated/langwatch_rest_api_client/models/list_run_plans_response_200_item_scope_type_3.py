from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ListRunPlansResponse200ItemScopeType3")


@_attrs_define
class ListRunPlansResponse200ItemScopeType3:
    """
    Attributes:
        mode (Literal['scenarios']):
    """

    mode: Literal["scenarios"]

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "mode": mode,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        mode = cast(Literal["scenarios"], d.pop("mode"))
        if mode != "scenarios":
            raise ValueError(f"mode must match const 'scenarios', got '{mode}'")

        list_run_plans_response_200_item_scope_type_3 = cls(
            mode=mode,
        )

        return list_run_plans_response_200_item_scope_type_3
