from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.read_cli_governance_status_response_200_setup import ReadCliGovernanceStatusResponse200Setup


T = TypeVar("T", bound="ReadCliGovernanceStatusResponse200")


@_attrs_define
class ReadCliGovernanceStatusResponse200:
    """
    Attributes:
        setup (ReadCliGovernanceStatusResponse200Setup):
    """

    setup: ReadCliGovernanceStatusResponse200Setup

    def to_dict(self) -> dict[str, Any]:
        setup = self.setup.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "setup": setup,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.read_cli_governance_status_response_200_setup import ReadCliGovernanceStatusResponse200Setup

        d = dict(src_dict)
        setup = ReadCliGovernanceStatusResponse200Setup.from_dict(d.pop("setup"))

        read_cli_governance_status_response_200 = cls(
            setup=setup,
        )

        return read_cli_governance_status_response_200
