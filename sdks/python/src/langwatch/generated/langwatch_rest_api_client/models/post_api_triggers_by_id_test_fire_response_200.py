from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_triggers_by_id_test_fire_response_200_channel import (
    PostApiTriggersByIdTestFireResponse200Channel,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiTriggersByIdTestFireResponse200")


@_attrs_define
class PostApiTriggersByIdTestFireResponse200:
    """
    Attributes:
        channel (PostApiTriggersByIdTestFireResponse200Channel):
        recipient_count (float):
        used_default (bool): Whether the LangWatch default message was rendered because this automation states no
            template of its own.
        missing_variables (list[str]):
        errors (list[str]):
        http_status (float | Unset): Webhook only: what the endpoint answered with.
    """

    channel: PostApiTriggersByIdTestFireResponse200Channel
    recipient_count: float
    used_default: bool
    missing_variables: list[str]
    errors: list[str]
    http_status: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        channel = self.channel.value

        recipient_count = self.recipient_count

        used_default = self.used_default

        missing_variables = self.missing_variables

        errors = self.errors

        http_status = self.http_status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "channel": channel,
                "recipientCount": recipient_count,
                "usedDefault": used_default,
                "missingVariables": missing_variables,
                "errors": errors,
            }
        )
        if http_status is not UNSET:
            field_dict["httpStatus"] = http_status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        channel = PostApiTriggersByIdTestFireResponse200Channel(d.pop("channel"))

        recipient_count = d.pop("recipientCount")

        used_default = d.pop("usedDefault")

        missing_variables = cast(list[str], d.pop("missingVariables"))

        errors = cast(list[str], d.pop("errors"))

        http_status = d.pop("httpStatus", UNSET)

        post_api_triggers_by_id_test_fire_response_200 = cls(
            channel=channel,
            recipient_count=recipient_count,
            used_default=used_default,
            missing_variables=missing_variables,
            errors=errors,
            http_status=http_status,
        )

        return post_api_triggers_by_id_test_fire_response_200
