from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiExperimentsRunsByRunIdResultsResponse200CompletenessDataset")


@_attrs_define
class GetApiExperimentsRunsByRunIdResultsResponse200CompletenessDataset:
    """
    Attributes:
        received (int):
        expected (int | None):
    """

    received: int
    expected: int | None

    def to_dict(self) -> dict[str, Any]:
        received = self.received

        expected: int | None
        expected = self.expected

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "received": received,
                "expected": expected,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        received = d.pop("received")

        def _parse_expected(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        expected = _parse_expected(d.pop("expected"))

        get_api_experiments_runs_by_run_id_results_response_200_completeness_dataset = cls(
            received=received,
            expected=expected,
        )

        return get_api_experiments_runs_by_run_id_results_response_200_completeness_dataset
