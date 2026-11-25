from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.revoke_worker_session_key_response_200_outcome import RevokeWorkerSessionKeyResponse200Outcome

T = TypeVar("T", bound="RevokeWorkerSessionKeyResponse200")


@_attrs_define
class RevokeWorkerSessionKeyResponse200:
    """
    Attributes:
        outcome (RevokeWorkerSessionKeyResponse200Outcome):
    """

    outcome: RevokeWorkerSessionKeyResponse200Outcome

    def to_dict(self) -> dict[str, Any]:
        outcome = self.outcome.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "outcome": outcome,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        outcome = RevokeWorkerSessionKeyResponse200Outcome(d.pop("outcome"))

        revoke_worker_session_key_response_200 = cls(
            outcome=outcome,
        )

        return revoke_worker_session_key_response_200
