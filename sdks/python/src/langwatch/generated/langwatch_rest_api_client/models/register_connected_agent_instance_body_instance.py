from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RegisterConnectedAgentInstanceBodyInstance")


@_attrs_define
class RegisterConnectedAgentInstanceBodyInstance:
    """
    Attributes:
        id (str):
        hostname (str):
        username (str):
        pid (int):
        started_at (str):
        label (str | Unset):
        in_flight_call_ids (list[str] | Unset):
        max_concurrency (int | Unset):
    """

    id: str
    hostname: str
    username: str
    pid: int
    started_at: str
    label: str | Unset = UNSET
    in_flight_call_ids: list[str] | Unset = UNSET
    max_concurrency: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        hostname = self.hostname

        username = self.username

        pid = self.pid

        started_at = self.started_at

        label = self.label

        in_flight_call_ids: list[str] | Unset = UNSET
        if not isinstance(self.in_flight_call_ids, Unset):
            in_flight_call_ids = self.in_flight_call_ids

        max_concurrency = self.max_concurrency

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "hostname": hostname,
                "username": username,
                "pid": pid,
                "startedAt": started_at,
            }
        )
        if label is not UNSET:
            field_dict["label"] = label
        if in_flight_call_ids is not UNSET:
            field_dict["inFlightCallIds"] = in_flight_call_ids
        if max_concurrency is not UNSET:
            field_dict["maxConcurrency"] = max_concurrency

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        hostname = d.pop("hostname")

        username = d.pop("username")

        pid = d.pop("pid")

        started_at = d.pop("startedAt")

        label = d.pop("label", UNSET)

        in_flight_call_ids = cast(list[str], d.pop("inFlightCallIds", UNSET))

        max_concurrency = d.pop("maxConcurrency", UNSET)

        register_connected_agent_instance_body_instance = cls(
            id=id,
            hostname=hostname,
            username=username,
            pid=pid,
            started_at=started_at,
            label=label,
            in_flight_call_ids=in_flight_call_ids,
            max_concurrency=max_concurrency,
        )

        return register_connected_agent_instance_body_instance
