from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.register_langy_control_session_body_protocol import RegisterLangyControlSessionBodyProtocol
from ..models.register_langy_control_session_body_type import RegisterLangyControlSessionBodyType

if TYPE_CHECKING:
    from ..models.register_langy_control_session_body_cli import RegisterLangyControlSessionBodyCli
    from ..models.register_langy_control_session_body_instance import RegisterLangyControlSessionBodyInstance
    from ..models.register_langy_control_session_body_workspace import RegisterLangyControlSessionBodyWorkspace


T = TypeVar("T", bound="RegisterLangyControlSessionBody")


@_attrs_define
class RegisterLangyControlSessionBody:
    """
    Attributes:
        protocol (RegisterLangyControlSessionBodyProtocol):
        type_ (RegisterLangyControlSessionBodyType):
        cli (RegisterLangyControlSessionBodyCli):
        instance (RegisterLangyControlSessionBodyInstance):
        workspace (RegisterLangyControlSessionBodyWorkspace):
    """

    protocol: RegisterLangyControlSessionBodyProtocol
    type_: RegisterLangyControlSessionBodyType
    cli: RegisterLangyControlSessionBodyCli
    instance: RegisterLangyControlSessionBodyInstance
    workspace: RegisterLangyControlSessionBodyWorkspace

    def to_dict(self) -> dict[str, Any]:
        protocol = self.protocol.value

        type_ = self.type_.value

        cli = self.cli.to_dict()

        instance = self.instance.to_dict()

        workspace = self.workspace.to_dict()

        field_dict: dict[str, Any] = {}

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
        protocol = RegisterLangyControlSessionBodyProtocol(d.pop("protocol"))

        type_ = RegisterLangyControlSessionBodyType(d.pop("type"))

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

        return register_langy_control_session_body
