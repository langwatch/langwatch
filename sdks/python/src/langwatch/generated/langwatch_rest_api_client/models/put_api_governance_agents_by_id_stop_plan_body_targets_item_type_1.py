from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1")


@_attrs_define
class PutApiGovernanceAgentsByIdStopPlanBodyTargetsItemType1:
    """
    Attributes:
        kind (Literal['bedrock_agent_alias']):
        aws_connection_id (str):
        region (str):
        agent_id (str):
        agent_alias_id (str):
    """

    kind: Literal["bedrock_agent_alias"]
    aws_connection_id: str
    region: str
    agent_id: str
    agent_alias_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        aws_connection_id = self.aws_connection_id

        region = self.region

        agent_id = self.agent_id

        agent_alias_id = self.agent_alias_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
                "awsConnectionId": aws_connection_id,
                "region": region,
                "agentId": agent_id,
                "agentAliasId": agent_alias_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = cast(Literal["bedrock_agent_alias"], d.pop("kind"))
        if kind != "bedrock_agent_alias":
            raise ValueError(f"kind must match const 'bedrock_agent_alias', got '{kind}'")

        aws_connection_id = d.pop("awsConnectionId")

        region = d.pop("region")

        agent_id = d.pop("agentId")

        agent_alias_id = d.pop("agentAliasId")

        put_api_governance_agents_by_id_stop_plan_body_targets_item_type_1 = cls(
            kind=kind,
            aws_connection_id=aws_connection_id,
            region=region,
            agent_id=agent_id,
            agent_alias_id=agent_alias_id,
        )

        put_api_governance_agents_by_id_stop_plan_body_targets_item_type_1.additional_properties = d
        return put_api_governance_agents_by_id_stop_plan_body_targets_item_type_1

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
