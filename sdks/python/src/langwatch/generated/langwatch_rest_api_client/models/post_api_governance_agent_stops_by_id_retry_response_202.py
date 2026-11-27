from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_governance_agent_stops_by_id_retry_response_202_data import (
        PostApiGovernanceAgentStopsByIdRetryResponse202Data,
    )


T = TypeVar("T", bound="PostApiGovernanceAgentStopsByIdRetryResponse202")


@_attrs_define
class PostApiGovernanceAgentStopsByIdRetryResponse202:
    """
    Attributes:
        data (PostApiGovernanceAgentStopsByIdRetryResponse202Data):
    """

    data: PostApiGovernanceAgentStopsByIdRetryResponse202Data

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
        from ..models.post_api_governance_agent_stops_by_id_retry_response_202_data import (
            PostApiGovernanceAgentStopsByIdRetryResponse202Data,
        )

        d = dict(src_dict)
        data = PostApiGovernanceAgentStopsByIdRetryResponse202Data.from_dict(d.pop("data"))

        post_api_governance_agent_stops_by_id_retry_response_202 = cls(
            data=data,
        )

        return post_api_governance_agent_stops_by_id_retry_response_202
