from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_governance_security_lake_sources_by_id_health_response_200_health_poison_item import (
        GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200HealthPoisonItem,
    )


T = TypeVar("T", bound="GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200Health")


@_attrs_define
class GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200Health:
    """
    Attributes:
        last_read_at (float | None):
        lag_ms (float | None):
        runs (int):
        messages (int):
        objects (int):
        rows (int):
        written (int):
        dropped (int):
        invalid (int):
        retried (int):
        poison_count (int):
        poison (list[GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200HealthPoisonItem]):
    """

    last_read_at: float | None
    lag_ms: float | None
    runs: int
    messages: int
    objects: int
    rows: int
    written: int
    dropped: int
    invalid: int
    retried: int
    poison_count: int
    poison: list[GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200HealthPoisonItem]

    def to_dict(self) -> dict[str, Any]:
        last_read_at: float | None
        last_read_at = self.last_read_at

        lag_ms: float | None
        lag_ms = self.lag_ms

        runs = self.runs

        messages = self.messages

        objects = self.objects

        rows = self.rows

        written = self.written

        dropped = self.dropped

        invalid = self.invalid

        retried = self.retried

        poison_count = self.poison_count

        poison = []
        for poison_item_data in self.poison:
            poison_item = poison_item_data.to_dict()
            poison.append(poison_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "lastReadAt": last_read_at,
                "lagMs": lag_ms,
                "runs": runs,
                "messages": messages,
                "objects": objects,
                "rows": rows,
                "written": written,
                "dropped": dropped,
                "invalid": invalid,
                "retried": retried,
                "poisonCount": poison_count,
                "poison": poison,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_security_lake_sources_by_id_health_response_200_health_poison_item import (
            GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200HealthPoisonItem,
        )

        d = dict(src_dict)

        def _parse_last_read_at(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        last_read_at = _parse_last_read_at(d.pop("lastReadAt"))

        def _parse_lag_ms(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        lag_ms = _parse_lag_ms(d.pop("lagMs"))

        runs = d.pop("runs")

        messages = d.pop("messages")

        objects = d.pop("objects")

        rows = d.pop("rows")

        written = d.pop("written")

        dropped = d.pop("dropped")

        invalid = d.pop("invalid")

        retried = d.pop("retried")

        poison_count = d.pop("poisonCount")

        poison = []
        _poison = d.pop("poison")
        for poison_item_data in _poison:
            poison_item = GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200HealthPoisonItem.from_dict(
                poison_item_data
            )

            poison.append(poison_item)

        get_api_governance_security_lake_sources_by_id_health_response_200_health = cls(
            last_read_at=last_read_at,
            lag_ms=lag_ms,
            runs=runs,
            messages=messages,
            objects=objects,
            rows=rows,
            written=written,
            dropped=dropped,
            invalid=invalid,
            retried=retried,
            poison_count=poison_count,
            poison=poison,
        )

        return get_api_governance_security_lake_sources_by_id_health_response_200_health
