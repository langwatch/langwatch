from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.register_langy_control_session_body_cli import RegisterLangyControlSessionBodyCli
    from ..models.register_langy_control_session_body_instance import RegisterLangyControlSessionBodyInstance
    from ..models.register_langy_control_session_body_workspace import RegisterLangyControlSessionBodyWorkspace


T = TypeVar("T", bound="RegisterLangyControlSessionBody")


@_attrs_define
class RegisterLangyControlSessionBody:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['register']):
        cli (RegisterLangyControlSessionBodyCli):
        instance (RegisterLangyControlSessionBodyInstance):
        workspace (RegisterLangyControlSessionBodyWorkspace):
    """

    protocol: Literal[1]
    type_: Literal["register"]
    cli: RegisterLangyControlSessionBodyCli
    instance: RegisterLangyControlSessionBodyInstance
    workspace: RegisterLangyControlSessionBodyWorkspace
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol

        type_ = self.type_

        cli = self.cli.to_dict()

        instance = self.instance.to_dict()

        workspace = self.workspace.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "cli": cli,
                "instance": instance,
                "workspace": workspace,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.register_langy_control_session_body_cli import RegisterLangyControlSessionBodyCli
        from ..models.register_langy_control_session_body_instance import RegisterLangyControlSessionBodyInstance
        from ..models.register_langy_control_session_body_workspace import RegisterLangyControlSessionBodyWorkspace

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["register"], d.pop("type"))
        if type_ != "register":
            raise ValueError(f"type must match const 'register', got '{type_}'")

        cli = RegisterLangyControlSessionBodyCli.from_dict(d.pop("cli"))

        instance = RegisterLangyControlSessionBodyInstance.from_dict(d.pop("instance"))

        workspace = RegisterLangyControlSessionBodyWorkspace.from_dict(d.pop("workspace"))

        register_langy_control_session_body = cls(
            protocol=protocol,
            type_=type_,
            cli=cli,
            instance=instance,
            workspace=workspace,
        )

        register_langy_control_session_body.additional_properties = d
        return register_langy_control_session_body

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
