from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="IngestTurnResultResponse202")


@_attrs_define
class IngestTurnResultResponse202:
    """
    Attributes:
        status (Literal['accepted']):
    """

    status: Literal["accepted"]

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = cast(Literal["accepted"], d.pop("status"))
        if status != "accepted":
            raise ValueError(f"status must match const 'accepted', got '{status}'")

        ingest_turn_result_response_202 = cls(
            status=status,
        )

        return ingest_turn_result_response_202
