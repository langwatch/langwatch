from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_slack_connections_response_200_item_kind import GetApiSlackConnectionsResponse200ItemKind
from ..models.get_api_slack_connections_response_200_item_scope_type import (
    GetApiSlackConnectionsResponse200ItemScopeType,
)

T = TypeVar("T", bound="GetApiSlackConnectionsResponse200Item")


@_attrs_define
class GetApiSlackConnectionsResponse200Item:
    """
    Attributes:
        id (str): What an automation's `slackIntegrationId` names to post through this connection.
        name (str):
        kind (GetApiSlackConnectionsResponse200ItemKind): `bot` posts as the LangWatch Slack app and needs a
            `slackChannelId` on the automation; `webhook` posts to its incoming webhook's channel.
        scope_type (GetApiSlackConnectionsResponse200ItemScopeType):
        scope_id (str):
        scope_name (str):
        slack_team_name (None | str): The Slack workspace a bot connection posts into.
        created_at (str):
    """

    id: str
    name: str
    kind: GetApiSlackConnectionsResponse200ItemKind
    scope_type: GetApiSlackConnectionsResponse200ItemScopeType
    scope_id: str
    scope_name: str
    slack_team_name: None | str
    created_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        kind = self.kind.value

        scope_type = self.scope_type.value

        scope_id = self.scope_id

        scope_name = self.scope_name

        slack_team_name: None | str
        slack_team_name = self.slack_team_name

        created_at = self.created_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "kind": kind,
                "scopeType": scope_type,
                "scopeId": scope_id,
                "scopeName": scope_name,
                "slackTeamName": slack_team_name,
                "createdAt": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        kind = GetApiSlackConnectionsResponse200ItemKind(d.pop("kind"))

        scope_type = GetApiSlackConnectionsResponse200ItemScopeType(d.pop("scopeType"))

        scope_id = d.pop("scopeId")

        scope_name = d.pop("scopeName")

        def _parse_slack_team_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        slack_team_name = _parse_slack_team_name(d.pop("slackTeamName"))

        created_at = d.pop("createdAt")

        get_api_slack_connections_response_200_item = cls(
            id=id,
            name=name,
            kind=kind,
            scope_type=scope_type,
            scope_id=scope_id,
            scope_name=scope_name,
            slack_team_name=slack_team_name,
            created_at=created_at,
        )

        get_api_slack_connections_response_200_item.additional_properties = d
        return get_api_slack_connections_response_200_item

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
