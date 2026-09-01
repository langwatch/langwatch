from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetRunPlanResponse200ScopeType2")


@_attrs_define
class GetRunPlanResponse200ScopeType2:
    """
    Attributes:
        mode (Literal['labels']):
        labels (list[str]):
    """

    mode: Literal["labels"]
    labels: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode

        labels = self.labels

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        get_run_plan_response_200_scope_type_2 = cls(
            mode=mode,
            labels=labels,
        )

        get_run_plan_response_200_scope_type_2.additional_properties = d
        return get_run_plan_response_200_scope_type_2

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
