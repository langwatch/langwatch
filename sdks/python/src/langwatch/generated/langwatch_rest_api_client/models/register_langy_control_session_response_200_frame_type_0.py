from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.register_langy_control_session_response_200_frame_type_0_conversation import (
        RegisterLangyControlSessionResponse200FrameType0Conversation,
    )
    from ..models.register_langy_control_session_response_200_frame_type_0_policy import (
        RegisterLangyControlSessionResponse200FrameType0Policy,
    )


T = TypeVar("T", bound="RegisterLangyControlSessionResponse200FrameType0")


@_attrs_define
class RegisterLangyControlSessionResponse200FrameType0:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['registered']):
        instance_id (str):
        heartbeat_interval_ms (int):
        conversation (RegisterLangyControlSessionResponse200FrameType0Conversation):
        policy (RegisterLangyControlSessionResponse200FrameType0Policy):
    """

    protocol: Literal[1]
    type_: Literal["registered"]
    instance_id: str
    heartbeat_interval_ms: int
    conversation: RegisterLangyControlSessionResponse200FrameType0Conversation
    policy: RegisterLangyControlSessionResponse200FrameType0Policy

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        instance_id = self.instance_id

        heartbeat_interval_ms = self.heartbeat_interval_ms

        conversation = self.conversation.to_dict()

        policy = self.policy.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "instanceId": instance_id,
                "heartbeatIntervalMs": heartbeat_interval_ms,
                "conversation": conversation,
                "policy": policy,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.register_langy_control_session_response_200_frame_type_0_conversation import (
            RegisterLangyControlSessionResponse200FrameType0Conversation,
        )
        from ..models.register_langy_control_session_response_200_frame_type_0_policy import (
            RegisterLangyControlSessionResponse200FrameType0Policy,
        )

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["registered"], d.pop("type"))
        if type_ != "registered":
            raise ValueError(f"type must match const 'registered', got '{type_}'")

        instance_id = d.pop("instanceId")

        heartbeat_interval_ms = d.pop("heartbeatIntervalMs")

        conversation = RegisterLangyControlSessionResponse200FrameType0Conversation.from_dict(d.pop("conversation"))

        policy = RegisterLangyControlSessionResponse200FrameType0Policy.from_dict(d.pop("policy"))

        register_langy_control_session_response_200_frame_type_0 = cls(
            protocol=protocol,
            type_=type_,
            instance_id=instance_id,
            heartbeat_interval_ms=heartbeat_interval_ms,
            conversation=conversation,
            policy=policy,
        )

        return register_langy_control_session_response_200_frame_type_0
