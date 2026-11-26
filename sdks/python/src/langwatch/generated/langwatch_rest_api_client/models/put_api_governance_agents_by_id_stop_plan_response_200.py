from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.put_api_governance_agents_by_id_stop_plan_response_200_data import (
        PutApiGovernanceAgentsByIdStopPlanResponse200Data,
    )


T = TypeVar("T", bound="PutApiGovernanceAgentsByIdStopPlanResponse200")


@_attrs_define
class PutApiGovernanceAgentsByIdStopPlanResponse200:
    """
    Attributes:
        data (PutApiGovernanceAgentsByIdStopPlanResponse200Data):
    """

    data: PutApiGovernanceAgentsByIdStopPlanResponse200Data

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
        from ..models.put_api_governance_agents_by_id_stop_plan_response_200_data import (
            PutApiGovernanceAgentsByIdStopPlanResponse200Data,
        )

        d = dict(src_dict)
        data = PutApiGovernanceAgentsByIdStopPlanResponse200Data.from_dict(d.pop("data"))

        put_api_governance_agents_by_id_stop_plan_response_200 = cls(
            data=data,
        )

        return put_api_governance_agents_by_id_stop_plan_response_200
