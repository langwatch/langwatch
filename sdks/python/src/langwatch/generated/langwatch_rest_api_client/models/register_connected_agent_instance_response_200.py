from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.register_connected_agent_instance_response_200_frame_type_0 import (
        RegisterConnectedAgentInstanceResponse200FrameType0,
    )
    from ..models.register_connected_agent_instance_response_200_frame_type_1 import (
        RegisterConnectedAgentInstanceResponse200FrameType1,
    )


T = TypeVar("T", bound="RegisterConnectedAgentInstanceResponse200")


@_attrs_define
class RegisterConnectedAgentInstanceResponse200:
    """
    Attributes:
        frame (RegisterConnectedAgentInstanceResponse200FrameType0 |
            RegisterConnectedAgentInstanceResponse200FrameType1): The registered frame, or the refused frame with its
            reason.
        instance_token (str | Unset): The token the poll and frames endpoints are addressed with, in the X-Agent-
            Instance-Token header. Present when the register was accepted.
    """

    frame: RegisterConnectedAgentInstanceResponse200FrameType0 | RegisterConnectedAgentInstanceResponse200FrameType1
    instance_token: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.register_connected_agent_instance_response_200_frame_type_0 import (
            RegisterConnectedAgentInstanceResponse200FrameType0,
        )

        frame: dict[str, Any]
        if isinstance(self.frame, RegisterConnectedAgentInstanceResponse200FrameType0):
            frame = self.frame.to_dict()
        else:
            frame = self.frame.to_dict()

        instance_token = self.instance_token

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "frame": frame,
            }
        )
        if instance_token is not UNSET:
            field_dict["instanceToken"] = instance_token

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.register_connected_agent_instance_response_200_frame_type_0 import (
            RegisterConnectedAgentInstanceResponse200FrameType0,
        )
        from ..models.register_connected_agent_instance_response_200_frame_type_1 import (
            RegisterConnectedAgentInstanceResponse200FrameType1,
        )

        d = dict(src_dict)

        def _parse_frame(
            data: object,
        ) -> RegisterConnectedAgentInstanceResponse200FrameType0 | RegisterConnectedAgentInstanceResponse200FrameType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                frame_type_0 = RegisterConnectedAgentInstanceResponse200FrameType0.from_dict(data)

                return frame_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            frame_type_1 = RegisterConnectedAgentInstanceResponse200FrameType1.from_dict(data)

            return frame_type_1

        frame = _parse_frame(d.pop("frame"))

        instance_token = d.pop("instanceToken", UNSET)

        register_connected_agent_instance_response_200 = cls(
            frame=frame,
            instance_token=instance_token,
        )

        register_connected_agent_instance_response_200.additional_properties = d
        return register_connected_agent_instance_response_200

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
