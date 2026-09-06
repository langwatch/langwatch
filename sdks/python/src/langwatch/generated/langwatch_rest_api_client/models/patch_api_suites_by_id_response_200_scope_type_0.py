from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PatchApiSuitesByIdResponse200ScopeType0")


@_attrs_define
class PatchApiSuitesByIdResponse200ScopeType0:
    """
    Attributes:
        mode (Literal['all']):
    """

    mode: Literal["all"]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        patch_api_suites_by_id_response_200_scope_type_0 = cls(
            mode=mode,
        )

        patch_api_suites_by_id_response_200_scope_type_0.additional_properties = d
        return patch_api_suites_by_id_response_200_scope_type_0

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
