from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType0Instance")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType0Instance:
    """
    Attributes:
        id (str):
        hostname (str):
        username (str):
        pid (int):
        started_at (str):
        in_flight_call_ids (list[str] | Unset):
    """

    id: str
    hostname: str
    username: str
    pid: int
    started_at: str
    in_flight_call_ids: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        hostname = self.hostname

        username = self.username

        pid = self.pid

        started_at = self.started_at

        in_flight_call_ids: list[str] | Unset = UNSET
        if not isinstance(self.in_flight_call_ids, Unset):
            in_flight_call_ids = self.in_flight_call_ids

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
        if in_flight_call_ids is not UNSET:
            field_dict["inFlightCallIds"] = in_flight_call_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        hostname = d.pop("hostname")

        username = d.pop("username")

        pid = d.pop("pid")

        started_at = d.pop("startedAt")

        in_flight_call_ids = cast(list[str], d.pop("inFlightCallIds", UNSET))

        post_langy_control_frames_body_frames_item_type_0_instance = cls(
            id=id,
            hostname=hostname,
            username=username,
            pid=pid,
            started_at=started_at,
            in_flight_call_ids=in_flight_call_ids,
        )

        return post_langy_control_frames_body_frames_item_type_0_instance
