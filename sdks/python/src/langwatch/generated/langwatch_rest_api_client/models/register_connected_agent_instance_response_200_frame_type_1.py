from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..models.register_connected_agent_instance_response_200_frame_type_1_code import (
    RegisterConnectedAgentInstanceResponse200FrameType1Code,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.register_connected_agent_instance_response_200_frame_type_1_meta import (
        RegisterConnectedAgentInstanceResponse200FrameType1Meta,
    )


T = TypeVar("T", bound="RegisterConnectedAgentInstanceResponse200FrameType1")


@_attrs_define
class RegisterConnectedAgentInstanceResponse200FrameType1:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['refused']):
        code (RegisterConnectedAgentInstanceResponse200FrameType1Code):
        message (str):
        meta (RegisterConnectedAgentInstanceResponse200FrameType1Meta | Unset):
    """

    protocol: Literal[1]
    type_: Literal["refused"]
    code: RegisterConnectedAgentInstanceResponse200FrameType1Code
    message: str
    meta: RegisterConnectedAgentInstanceResponse200FrameType1Meta | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        code = self.code.value

        message = self.message

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "code": code,
                "message": message,
            }
        )
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.register_connected_agent_instance_response_200_frame_type_1_meta import (
            RegisterConnectedAgentInstanceResponse200FrameType1Meta,
        )

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["refused"], d.pop("type"))
        if type_ != "refused":
            raise ValueError(f"type must match const 'refused', got '{type_}'")

        code = RegisterConnectedAgentInstanceResponse200FrameType1Code(d.pop("code"))

        message = d.pop("message")

        _meta = d.pop("meta", UNSET)
        meta: RegisterConnectedAgentInstanceResponse200FrameType1Meta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = RegisterConnectedAgentInstanceResponse200FrameType1Meta.from_dict(_meta)

        register_connected_agent_instance_response_200_frame_type_1 = cls(
            protocol=protocol,
            type_=type_,
            code=code,
            message=message,
            meta=meta,
        )

        return register_connected_agent_instance_response_200_frame_type_1
