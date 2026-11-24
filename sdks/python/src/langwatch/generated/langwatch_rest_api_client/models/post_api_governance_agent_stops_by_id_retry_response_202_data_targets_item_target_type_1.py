from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostApiGovernanceAgentStopsByIdRetryResponse202DataTargetsItemTargetType1")


@_attrs_define
class PostApiGovernanceAgentStopsByIdRetryResponse202DataTargetsItemTargetType1:
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

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        aws_connection_id = self.aws_connection_id

        region = self.region

        agent_id = self.agent_id

        agent_alias_id = self.agent_alias_id

        field_dict: dict[str, Any] = {}

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

        post_api_governance_agent_stops_by_id_retry_response_202_data_targets_item_target_type_1 = cls(
            kind=kind,
            aws_connection_id=aws_connection_id,
            region=region,
            agent_id=agent_id,
            agent_alias_id=agent_alias_id,
        )

        return post_api_governance_agent_stops_by_id_retry_response_202_data_targets_item_target_type_1
