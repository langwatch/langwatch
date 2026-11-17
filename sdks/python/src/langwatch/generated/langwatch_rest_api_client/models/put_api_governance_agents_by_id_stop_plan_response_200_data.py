from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.put_api_governance_agents_by_id_stop_plan_response_200_data_targets_item import (
        PutApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItem,
    )


T = TypeVar("T", bound="PutApiGovernanceAgentsByIdStopPlanResponse200Data")


@_attrs_define
class PutApiGovernanceAgentsByIdStopPlanResponse200Data:
    """
    Attributes:
        agent_id (str):
        targets (list[PutApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItem]):
        updated_at (None | str):
        version (int):
    """

    agent_id: str
    targets: list[PutApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItem]
    updated_at: None | str
    version: int

    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)

        updated_at: None | str
        updated_at = self.updated_at

        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "agentId": agent_id,
                "targets": targets,
                "updatedAt": updated_at,
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_governance_agents_by_id_stop_plan_response_200_data_targets_item import (
            PutApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItem,
        )

        d = dict(src_dict)
        agent_id = d.pop("agentId")

        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = PutApiGovernanceAgentsByIdStopPlanResponse200DataTargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

        def _parse_updated_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        updated_at = _parse_updated_at(d.pop("updatedAt"))

        version = d.pop("version")

        put_api_governance_agents_by_id_stop_plan_response_200_data = cls(
            agent_id=agent_id,
            targets=targets,
            updated_at=updated_at,
            version=version,
        )

        return put_api_governance_agents_by_id_stop_plan_response_200_data
