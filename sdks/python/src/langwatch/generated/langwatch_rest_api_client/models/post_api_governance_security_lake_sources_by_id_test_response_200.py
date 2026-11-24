from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiGovernanceSecurityLakeSourcesByIdTestResponse200")


@_attrs_define
class PostApiGovernanceSecurityLakeSourcesByIdTestResponse200:
    """
    Attributes:
        ok (bool):
        waiting (int | None):
        in_flight (int | None):
        error (None | str):
    """

    ok: bool
    waiting: int | None
    in_flight: int | None
    error: None | str

    def to_dict(self) -> dict[str, Any]:
        ok = self.ok

        waiting: int | None
        waiting = self.waiting

        in_flight: int | None
        in_flight = self.in_flight

        error: None | str
        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ok": ok,
                "waiting": waiting,
                "inFlight": in_flight,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ok = d.pop("ok")

        def _parse_waiting(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        waiting = _parse_waiting(d.pop("waiting"))

        def _parse_in_flight(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        in_flight = _parse_in_flight(d.pop("inFlight"))

        def _parse_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error = _parse_error(d.pop("error"))

        post_api_governance_security_lake_sources_by_id_test_response_200 = cls(
            ok=ok,
            waiting=waiting,
            in_flight=in_flight,
            error=error,
        )

        return post_api_governance_security_lake_sources_by_id_test_response_200
