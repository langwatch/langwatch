from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="RegisterLangyControlSessionResponse200FrameType0Policy")


@_attrs_define
class RegisterLangyControlSessionResponse200FrameType0Policy:
    """
    Attributes:
        skip_permissions (bool):
    """

    skip_permissions: bool

    def to_dict(self) -> dict[str, Any]:
        skip_permissions = self.skip_permissions

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "skipPermissions": skip_permissions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        skip_permissions = d.pop("skipPermissions")

        register_langy_control_session_response_200_frame_type_0_policy = cls(
            skip_permissions=skip_permissions,
        )

        return register_langy_control_session_response_200_frame_type_0_policy
