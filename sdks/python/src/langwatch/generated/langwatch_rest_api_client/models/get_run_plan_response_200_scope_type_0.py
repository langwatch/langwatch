from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetRunPlanResponse200ScopeType0")


@_attrs_define
class GetRunPlanResponse200ScopeType0:
    """
    Attributes:
        mode (Literal['all']):
    """

    mode: Literal["all"]

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
        mode = cast(Literal["all"], d.pop("mode"))
        if mode != "all":
            raise ValueError(f"mode must match const 'all', got '{mode}'")

        get_run_plan_response_200_scope_type_0 = cls(
            mode=mode,
        )

        return get_run_plan_response_200_scope_type_0
