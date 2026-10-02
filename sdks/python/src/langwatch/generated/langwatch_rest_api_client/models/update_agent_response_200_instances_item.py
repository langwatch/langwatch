from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

if TYPE_CHECKING:
    from ..models.update_agent_response_200_instances_item_sdk import UpdateAgentResponse200InstancesItemSdk


T = TypeVar("T", bound="UpdateAgentResponse200InstancesItem")


@_attrs_define
class UpdateAgentResponse200InstancesItem:
    """
    Attributes:
        instance_id (str):
        hostname (str):
        username (str):
        pid (float):
        label (None | str):
        sdk (UpdateAgentResponse200InstancesItemSdk):
        connected_at (datetime.datetime):
        inflight (float):
        max_concurrency (float):
    """

    instance_id: str
    hostname: str
    username: str
    pid: float
    label: None | str
    sdk: UpdateAgentResponse200InstancesItemSdk
    connected_at: datetime.datetime
    inflight: float
    max_concurrency: float

    def to_dict(self) -> dict[str, Any]:
        instance_id = self.instance_id

        hostname = self.hostname

        username = self.username

        pid = self.pid

        label: None | str
        label = self.label

        sdk = self.sdk.to_dict()

        connected_at = self.connected_at.isoformat()

        inflight = self.inflight

        max_concurrency = self.max_concurrency

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "instanceId": instance_id,
                "hostname": hostname,
                "username": username,
                "pid": pid,
                "label": label,
                "sdk": sdk,
                "connectedAt": connected_at,
                "inflight": inflight,
                "maxConcurrency": max_concurrency,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_agent_response_200_instances_item_sdk import UpdateAgentResponse200InstancesItemSdk

        d = dict(src_dict)
        instance_id = d.pop("instanceId")

        hostname = d.pop("hostname")

        username = d.pop("username")

        pid = d.pop("pid")

        def _parse_label(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        label = _parse_label(d.pop("label"))

        sdk = UpdateAgentResponse200InstancesItemSdk.from_dict(d.pop("sdk"))

        connected_at = isoparse(d.pop("connectedAt"))

        inflight = d.pop("inflight")

        max_concurrency = d.pop("maxConcurrency")

        update_agent_response_200_instances_item = cls(
            instance_id=instance_id,
            hostname=hostname,
            username=username,
            pid=pid,
            label=label,
            sdk=sdk,
            connected_at=connected_at,
            inflight=inflight,
            max_concurrency=max_concurrency,
        )

        return update_agent_response_200_instances_item
