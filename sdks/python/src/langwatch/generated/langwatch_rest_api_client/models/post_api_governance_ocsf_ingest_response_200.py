from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiGovernanceOcsfIngestResponse200")


@_attrs_define
class PostApiGovernanceOcsfIngestResponse200:
    """
    Attributes:
        accepted (int):
    """

    accepted: int

    def to_dict(self) -> dict[str, Any]:
        accepted = self.accepted

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "accepted": accepted,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        accepted = d.pop("accepted")

        post_api_governance_ocsf_ingest_response_200 = cls(
            accepted=accepted,
        )

        return post_api_governance_ocsf_ingest_response_200
