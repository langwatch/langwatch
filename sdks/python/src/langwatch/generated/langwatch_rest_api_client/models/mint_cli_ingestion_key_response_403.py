from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="MintCliIngestionKeyResponse403")


@_attrs_define
class MintCliIngestionKeyResponse403:
    """
    Attributes:
        error (str):
        error_description (str):
        upgrade_url (str | Unset):
    """

    error: str
    error_description: str
    upgrade_url: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        error_description = self.error_description

        upgrade_url = self.upgrade_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
                "error_description": error_description,
            }
        )
        if upgrade_url is not UNSET:
            field_dict["upgrade_url"] = upgrade_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        error = d.pop("error")

        error_description = d.pop("error_description")

        upgrade_url = d.pop("upgrade_url", UNSET)

        mint_cli_ingestion_key_response_403 = cls(
            error=error,
            error_description=error_description,
            upgrade_url=upgrade_url,
        )

        return mint_cli_ingestion_key_response_403
