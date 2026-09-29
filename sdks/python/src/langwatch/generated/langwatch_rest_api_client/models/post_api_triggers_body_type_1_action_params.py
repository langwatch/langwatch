from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_triggers_body_type_1_action_params_slack_delivery import (
    PostApiTriggersBodyType1ActionParamsSlackDelivery,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiTriggersBodyType1ActionParams")


@_attrs_define
class PostApiTriggersBodyType1ActionParams:
    """Slack delivery through a Slack connection (`slackIntegrationId`), plus `slackChannelId` when the connection is a
    bot.

        Attributes:
            slack_integration_id (str | Unset): The Slack connection this automation posts through: an organization
                connection or one of this project's, listed under Settings, Integrations, Slack. A bot connection also needs
                `slackChannelId`; a webhook connection needs nothing else. Preferred over `slackWebhook` and `slackBotToken`,
                and what a read returns in their place.
            slack_delivery (PostApiTriggersBodyType1ActionParamsSlackDelivery | Unset): How the message reaches Slack.
                `webhook` posts to an incoming webhook URL, `bot` posts as the LangWatch Slack app. With `slackIntegrationId` it
                follows the connection's kind. Absent without a connection means `webhook`.
            slack_webhook (str | Unset): Legacy, accepted for one release: an incoming webhook URL, for `webhook` delivery.
                It is stored as a Slack connection (an existing one holding the same URL, else a new project connection) and the
                automation keeps only that connection's id. Send `slackIntegrationId` instead.
            slack_channel_id (str | Unset): The channel the bot posts in, for a bot connection or `bot` delivery. Invite the
                LangWatch app to it first.
            slack_bot_token (str | Unset): Legacy, accepted for one release: a bot token, for `bot` delivery. It is stored
                as a Slack connection (an existing one holding the same token, else a new project connection) and never reads
                back. Send `slackIntegrationId` instead.
            slack_bot_token_set (bool | Unset): Legacy and ignored: no read returns it. An update that retypes no secret
                moves an automation's own stored secret into a connection.
    """

    slack_integration_id: str | Unset = UNSET
    slack_delivery: PostApiTriggersBodyType1ActionParamsSlackDelivery | Unset = UNSET
    slack_webhook: str | Unset = UNSET
    slack_channel_id: str | Unset = UNSET
    slack_bot_token: str | Unset = UNSET
    slack_bot_token_set: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        slack_integration_id = self.slack_integration_id

        slack_delivery: str | Unset = UNSET
        if not isinstance(self.slack_delivery, Unset):
            slack_delivery = self.slack_delivery.value

        slack_webhook = self.slack_webhook

        slack_channel_id = self.slack_channel_id

        slack_bot_token = self.slack_bot_token

        slack_bot_token_set = self.slack_bot_token_set

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if slack_integration_id is not UNSET:
            field_dict["slackIntegrationId"] = slack_integration_id
        if slack_delivery is not UNSET:
            field_dict["slackDelivery"] = slack_delivery
        if slack_webhook is not UNSET:
            field_dict["slackWebhook"] = slack_webhook
        if slack_channel_id is not UNSET:
            field_dict["slackChannelId"] = slack_channel_id
        if slack_bot_token is not UNSET:
            field_dict["slackBotToken"] = slack_bot_token
        if slack_bot_token_set is not UNSET:
            field_dict["slackBotTokenSet"] = slack_bot_token_set

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        slack_integration_id = d.pop("slackIntegrationId", UNSET)

        _slack_delivery = d.pop("slackDelivery", UNSET)
        slack_delivery: PostApiTriggersBodyType1ActionParamsSlackDelivery | Unset
        if isinstance(_slack_delivery, Unset):
            slack_delivery = UNSET
        else:
            slack_delivery = PostApiTriggersBodyType1ActionParamsSlackDelivery(_slack_delivery)

        slack_webhook = d.pop("slackWebhook", UNSET)

        slack_channel_id = d.pop("slackChannelId", UNSET)

        slack_bot_token = d.pop("slackBotToken", UNSET)

        slack_bot_token_set = d.pop("slackBotTokenSet", UNSET)

        post_api_triggers_body_type_1_action_params = cls(
            slack_integration_id=slack_integration_id,
            slack_delivery=slack_delivery,
            slack_webhook=slack_webhook,
            slack_channel_id=slack_channel_id,
            slack_bot_token=slack_bot_token,
            slack_bot_token_set=slack_bot_token_set,
        )

        post_api_triggers_body_type_1_action_params.additional_properties = d
        return post_api_triggers_body_type_1_action_params

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
