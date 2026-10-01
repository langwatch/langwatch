from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_langy_control_frames_body_frames_item_type_0_cli import (
        PostLangyControlFramesBodyFramesItemType0Cli,
    )
    from ..models.post_langy_control_frames_body_frames_item_type_0_instance import (
        PostLangyControlFramesBodyFramesItemType0Instance,
    )
    from ..models.post_langy_control_frames_body_frames_item_type_0_workspace import (
        PostLangyControlFramesBodyFramesItemType0Workspace,
    )


T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType0")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType0:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['register']):
        cli (PostLangyControlFramesBodyFramesItemType0Cli):
        instance (PostLangyControlFramesBodyFramesItemType0Instance):
        workspace (PostLangyControlFramesBodyFramesItemType0Workspace):
    """

    protocol: Literal[1]
    type_: Literal["register"]
    cli: PostLangyControlFramesBodyFramesItemType0Cli
    instance: PostLangyControlFramesBodyFramesItemType0Instance
    workspace: PostLangyControlFramesBodyFramesItemType0Workspace
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
        from ..models.post_langy_control_frames_body_frames_item_type_0_cli import (
            PostLangyControlFramesBodyFramesItemType0Cli,
        )
        from ..models.post_langy_control_frames_body_frames_item_type_0_instance import (
            PostLangyControlFramesBodyFramesItemType0Instance,
        )
        from ..models.post_langy_control_frames_body_frames_item_type_0_workspace import (
            PostLangyControlFramesBodyFramesItemType0Workspace,
        )

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["register"], d.pop("type"))
        if type_ != "register":
            raise ValueError(f"type must match const 'register', got '{type_}'")

        cli = PostLangyControlFramesBodyFramesItemType0Cli.from_dict(d.pop("cli"))

        instance = PostLangyControlFramesBodyFramesItemType0Instance.from_dict(d.pop("instance"))

        workspace = PostLangyControlFramesBodyFramesItemType0Workspace.from_dict(d.pop("workspace"))

        post_langy_control_frames_body_frames_item_type_0 = cls(
            protocol=protocol,
            type_=type_,
            cli=cli,
            instance=instance,
            workspace=workspace,
        )

        post_langy_control_frames_body_frames_item_type_0.additional_properties = d
        return post_langy_control_frames_body_frames_item_type_0

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
