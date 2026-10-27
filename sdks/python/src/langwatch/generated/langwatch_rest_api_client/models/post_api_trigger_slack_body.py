from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_trigger_slack_body_alert_type import PostApiTriggerSlackBodyAlertType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_trigger_slack_body_filters import PostApiTriggerSlackBodyFilters


T = TypeVar("T", bound="PostApiTriggerSlackBody")


@_attrs_define
class PostApiTriggerSlackBody:
    """
    Attributes:
        name (str): How the trigger is listed in the app
        alert_type (PostApiTriggerSlackBodyAlertType):
        slack_webhook (str | Unset): Incoming webhook URL the alert is posted to. It is stored as a Slack connection
            this project can use (an existing one holding the same URL, else a new project connection). Send this or
            `slack_connection_id`, not both.
        slack_connection_id (str | Unset): The Slack connection the alert posts through: an organization connection or
            one of this project's, as `GET /api/slack-connections` and `langwatch slack-connection list` list them. Send
            this or `slack_webhook`, not both.
        slack_channel_id (str | Unset): The channel a bot connection posts in; required with one. Invite the LangWatch
            app to it first.
        message (str | Unset): Extra line included with each alert
        filters (PostApiTriggerSlackBodyFilters | Unset): Which traces the trigger fires on. An empty object fires on
            all of them.
    """

    name: str
    alert_type: PostApiTriggerSlackBodyAlertType
    slack_webhook: str | Unset = UNSET
    slack_connection_id: str | Unset = UNSET
    slack_channel_id: str | Unset = UNSET
    message: str | Unset = UNSET
    filters: PostApiTriggerSlackBodyFilters | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        alert_type = self.alert_type.value

        slack_webhook = self.slack_webhook

        slack_connection_id = self.slack_connection_id

        slack_channel_id = self.slack_channel_id

        message = self.message

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "alert_type": alert_type,
            }
        )
        if slack_webhook is not UNSET:
            field_dict["slack_webhook"] = slack_webhook
        if slack_connection_id is not UNSET:
            field_dict["slack_connection_id"] = slack_connection_id
        if slack_channel_id is not UNSET:
            field_dict["slack_channel_id"] = slack_channel_id
        if message is not UNSET:
            field_dict["message"] = message
        if filters is not UNSET:
            field_dict["filters"] = filters

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_trigger_slack_body_filters import PostApiTriggerSlackBodyFilters

        d = dict(src_dict)
        name = d.pop("name")

        alert_type = PostApiTriggerSlackBodyAlertType(d.pop("alert_type"))

        slack_webhook = d.pop("slack_webhook", UNSET)

        slack_connection_id = d.pop("slack_connection_id", UNSET)

        slack_channel_id = d.pop("slack_channel_id", UNSET)

        message = d.pop("message", UNSET)

        _filters = d.pop("filters", UNSET)
        filters: PostApiTriggerSlackBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiTriggerSlackBodyFilters.from_dict(_filters)

        post_api_trigger_slack_body = cls(
            name=name,
            alert_type=alert_type,
            slack_webhook=slack_webhook,
            slack_connection_id=slack_connection_id,
            slack_channel_id=slack_channel_id,
            message=message,
            filters=filters,
        )

        post_api_trigger_slack_body.additional_properties = d
        return post_api_trigger_slack_body

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
