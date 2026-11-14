from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_type import (
    GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemType,
)

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent import (
        GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgent,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItem")


@_attrs_define
class GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItem:
    """
    Attributes:
        id (str):
        sequence (str):
        type_ (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemType):
        organization_id (str):
        agent_id (str):
        from_version (int | None):
        to_version (int | None):
        tool (None | str):
        occurred_at (str):
        agent (GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgent):
    """

    id: str
    sequence: str
    type_: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemType
    organization_id: str
    agent_id: str
    from_version: int | None
    to_version: int | None
    tool: None | str
    occurred_at: str
    agent: GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgent

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        sequence = self.sequence

        type_ = self.type_.value

        organization_id = self.organization_id

        agent_id = self.agent_id

        from_version: int | None
        from_version = self.from_version

        to_version: int | None
        to_version = self.to_version

        tool: None | str
        tool = self.tool

        occurred_at = self.occurred_at

        agent = self.agent.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sequence": sequence,
                "type": type_,
                "organization_id": organization_id,
                "agent_id": agent_id,
                "from_version": from_version,
                "to_version": to_version,
                "tool": tool,
                "occurred_at": occurred_at,
                "agent": agent,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_registry_agents_by_id_versions_response_200_data_item_agent import (
            GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgent,
        )

        d = dict(src_dict)
        id = d.pop("id")

        sequence = d.pop("sequence")

        type_ = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemType(d.pop("type"))

        organization_id = d.pop("organization_id")

        agent_id = d.pop("agent_id")

        def _parse_from_version(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        from_version = _parse_from_version(d.pop("from_version"))

        def _parse_to_version(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        to_version = _parse_to_version(d.pop("to_version"))

        def _parse_tool(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        tool = _parse_tool(d.pop("tool"))

        occurred_at = d.pop("occurred_at")

        agent = GetApiGovernanceRegistryAgentsByIdVersionsResponse200DataItemAgent.from_dict(d.pop("agent"))

        get_api_governance_registry_agents_by_id_versions_response_200_data_item = cls(
            id=id,
            sequence=sequence,
            type_=type_,
            organization_id=organization_id,
            agent_id=agent_id,
            from_version=from_version,
            to_version=to_version,
            tool=tool,
            occurred_at=occurred_at,
            agent=agent,
        )

        return get_api_governance_registry_agents_by_id_versions_response_200_data_item
