from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        code = self.code.value

        message = self.message

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        register_connected_agent_instance_response_200_frame_type_1.additional_properties = d
        return register_connected_agent_instance_response_200_frame_type_1

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
