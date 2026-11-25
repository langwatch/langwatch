from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_governance_agents_by_id_stop_response_202_data import (
        PostApiGovernanceAgentsByIdStopResponse202Data,
    )


T = TypeVar("T", bound="PostApiGovernanceAgentsByIdStopResponse202")


@_attrs_define
class PostApiGovernanceAgentsByIdStopResponse202:
    """
    Attributes:
        data (PostApiGovernanceAgentsByIdStopResponse202Data):
    """

    data: PostApiGovernanceAgentsByIdStopResponse202Data

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
        from ..models.post_api_governance_agents_by_id_stop_response_202_data import (
            PostApiGovernanceAgentsByIdStopResponse202Data,
        )

        d = dict(src_dict)
        data = PostApiGovernanceAgentsByIdStopResponse202Data.from_dict(d.pop("data"))

        post_api_governance_agents_by_id_stop_response_202 = cls(
            data=data,
        )

        return post_api_governance_agents_by_id_stop_response_202
