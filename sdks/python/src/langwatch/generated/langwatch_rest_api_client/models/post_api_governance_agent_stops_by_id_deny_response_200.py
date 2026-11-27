from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_governance_agent_stops_by_id_deny_response_200_data import (
        PostApiGovernanceAgentStopsByIdDenyResponse200Data,
    )


T = TypeVar("T", bound="PostApiGovernanceAgentStopsByIdDenyResponse200")


@_attrs_define
class PostApiGovernanceAgentStopsByIdDenyResponse200:
    """
    Attributes:
        data (PostApiGovernanceAgentStopsByIdDenyResponse200Data):
    """

    data: PostApiGovernanceAgentStopsByIdDenyResponse200Data

    def to_dict(self) -> dict[str, Any]:
        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_agent_stops_by_id_deny_response_200_data import (
            PostApiGovernanceAgentStopsByIdDenyResponse200Data,
        )

        d = dict(src_dict)
        data = PostApiGovernanceAgentStopsByIdDenyResponse200Data.from_dict(d.pop("data"))

        post_api_governance_agent_stops_by_id_deny_response_200 = cls(
            data=data,
        )

        return post_api_governance_agent_stops_by_id_deny_response_200
