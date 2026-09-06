from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_agent_response_200_instances_item_sdk import GetAgentResponse200InstancesItemSdk


T = TypeVar("T", bound="GetAgentResponse200InstancesItem")


@_attrs_define
class GetAgentResponse200InstancesItem:
    """
    Attributes:
        instance_id (str):
        hostname (str):
        username (str):
        pid (float):
        label (None | str):
        sdk (GetAgentResponse200InstancesItemSdk):
        connected_at (str):
        inflight (float):
        max_concurrency (float):
    """

    instance_id: str
    hostname: str
    username: str
    pid: float
    label: None | str
    sdk: GetAgentResponse200InstancesItemSdk
    connected_at: str
    inflight: float
    max_concurrency: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        instance_id = self.instance_id

        hostname = self.hostname

        username = self.username

        pid = self.pid

        label: None | str
        label = self.label

        sdk = self.sdk.to_dict()

        connected_at = self.connected_at

        inflight = self.inflight

        max_concurrency = self.max_concurrency

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.get_agent_response_200_instances_item_sdk import GetAgentResponse200InstancesItemSdk

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

        sdk = GetAgentResponse200InstancesItemSdk.from_dict(d.pop("sdk"))

        connected_at = d.pop("connectedAt")

        inflight = d.pop("inflight")

        max_concurrency = d.pop("maxConcurrency")

        get_agent_response_200_instances_item = cls(
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

        get_agent_response_200_instances_item.additional_properties = d
        return get_agent_response_200_instances_item

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
