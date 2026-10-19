from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LangyLocalStartWaitResponse200")


@_attrs_define
class LangyLocalStartWaitResponse200:
    """
    Attributes:
        wait_id (str):
    """

    wait_id: str

    def to_dict(self) -> dict[str, Any]:
        wait_id = self.wait_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "waitId": wait_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        wait_id = d.pop("waitId")

        langy_local_start_wait_response_200 = cls(
            wait_id=wait_id,
        )

        return langy_local_start_wait_response_200
