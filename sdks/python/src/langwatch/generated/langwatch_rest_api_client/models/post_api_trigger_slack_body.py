from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_api_trigger_slack_body_alert_type import PostApiTriggerSlackBodyAlertType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_trigger_slack_body_filters import PostApiTriggerSlackBodyFilters


T = TypeVar("T", bound="PostApiTriggerSlackBody")


@_attrs_define
class PostApiTriggerSlackBody:
    """
    Attributes:
        slack_webhook (str): Incoming webhook URL the alert is posted to
        name (str): How the trigger is listed in the app
        alert_type (PostApiTriggerSlackBodyAlertType):
        message (str | Unset): Extra line included with each alert
        filters (PostApiTriggerSlackBodyFilters | Unset): Which traces the trigger fires on. An empty object fires on
            all of them.
    """

    slack_webhook: str
    name: str
    alert_type: PostApiTriggerSlackBodyAlertType
    message: str | Unset = UNSET
    filters: PostApiTriggerSlackBodyFilters | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        slack_webhook = self.slack_webhook

        name = self.name

        alert_type = self.alert_type.value

        message = self.message

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "slack_webhook": slack_webhook,
                "name": name,
                "alert_type": alert_type,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message
        if filters is not UNSET:
            field_dict["filters"] = filters

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_trigger_slack_body_filters import PostApiTriggerSlackBodyFilters

        d = dict(src_dict)
        slack_webhook = d.pop("slack_webhook")

        name = d.pop("name")

        alert_type = PostApiTriggerSlackBodyAlertType(d.pop("alert_type"))

        message = d.pop("message", UNSET)

        _filters = d.pop("filters", UNSET)
        filters: PostApiTriggerSlackBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiTriggerSlackBodyFilters.from_dict(_filters)

        post_api_trigger_slack_body = cls(
            slack_webhook=slack_webhook,
            name=name,
            alert_type=alert_type,
            message=message,
            filters=filters,
        )

        return post_api_trigger_slack_body
