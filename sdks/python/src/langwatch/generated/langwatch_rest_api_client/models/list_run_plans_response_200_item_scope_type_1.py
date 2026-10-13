from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ListRunPlansResponse200ItemScopeType1")


@_attrs_define
class ListRunPlansResponse200ItemScopeType1:
    """
    Attributes:
        mode (Literal['test_suites']):
        test_suite_ids (list[str]):
    """

    mode: Literal["test_suites"]
    test_suite_ids: list[str]

    def to_dict(self) -> dict[str, Any]:
        mode = self.mode

        test_suite_ids = self.test_suite_ids

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "mode": mode,
                "testSuiteIds": test_suite_ids,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        mode = cast(Literal["test_suites"], d.pop("mode"))
        if mode != "test_suites":
            raise ValueError(f"mode must match const 'test_suites', got '{mode}'")

        test_suite_ids = cast(list[str], d.pop("testSuiteIds"))

        list_run_plans_response_200_item_scope_type_1 = cls(
            mode=mode,
            test_suite_ids=test_suite_ids,
        )

        return list_run_plans_response_200_item_scope_type_1
