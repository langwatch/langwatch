from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiSuitesByIdDuplicateResponse201ScopeType0Type3")


@_attrs_define
class PostApiSuitesByIdDuplicateResponse201ScopeType0Type3:
    """
    Attributes:
        mode (Literal['cases']):
    """

    mode: Literal["cases"]

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
        mode = cast(Literal["cases"], d.pop("mode"))
        if mode != "cases":
            raise ValueError(f"mode must match const 'cases', got '{mode}'")

        post_api_suites_by_id_duplicate_response_201_scope_type_0_type_3 = cls(
            mode=mode,
        )

        return post_api_suites_by_id_duplicate_response_201_scope_type_0_type_3
