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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        slack_webhook = self.slack_webhook

        name = self.name

        alert_type = self.alert_type.value

        message = self.message

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
