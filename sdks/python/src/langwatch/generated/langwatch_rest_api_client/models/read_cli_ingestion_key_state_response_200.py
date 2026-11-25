from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.read_cli_ingestion_key_state_response_200_status import ReadCliIngestionKeyStateResponse200Status
from ..types import UNSET, Unset

T = TypeVar("T", bound="ReadCliIngestionKeyStateResponse200")


@_attrs_define
class ReadCliIngestionKeyStateResponse200:
    """
    Attributes:
        lookup_id (str):
        status (ReadCliIngestionKeyStateResponse200Status):
        source_type (str | Unset):
        revocation_cause (None | str | Unset):
    """

    lookup_id: str
    status: ReadCliIngestionKeyStateResponse200Status
    source_type: str | Unset = UNSET
    revocation_cause: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        lookup_id = self.lookup_id

        status = self.status.value

        source_type = self.source_type

        revocation_cause: None | str | Unset
        if isinstance(self.revocation_cause, Unset):
            revocation_cause = UNSET
        else:
            revocation_cause = self.revocation_cause

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "lookup_id": lookup_id,
                "status": status,
            }
        )
        if source_type is not UNSET:
            field_dict["source_type"] = source_type
        if revocation_cause is not UNSET:
            field_dict["revocation_cause"] = revocation_cause

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        lookup_id = d.pop("lookup_id")

        status = ReadCliIngestionKeyStateResponse200Status(d.pop("status"))

        source_type = d.pop("source_type", UNSET)

        def _parse_revocation_cause(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        revocation_cause = _parse_revocation_cause(d.pop("revocation_cause", UNSET))

        read_cli_ingestion_key_state_response_200 = cls(
            lookup_id=lookup_id,
            status=status,
            source_type=source_type,
            revocation_cause=revocation_cause,
        )

        return read_cli_ingestion_key_state_response_200
