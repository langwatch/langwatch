from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_langy_control_frames_body_frames_item_type_0_protocol import (
    PostLangyControlFramesBodyFramesItemType0Protocol,
)
from ..models.post_langy_control_frames_body_frames_item_type_0_type import (
    PostLangyControlFramesBodyFramesItemType0Type,
)

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
        protocol (PostLangyControlFramesBodyFramesItemType0Protocol):
        type_ (PostLangyControlFramesBodyFramesItemType0Type):
        cli (PostLangyControlFramesBodyFramesItemType0Cli):
        instance (PostLangyControlFramesBodyFramesItemType0Instance):
        workspace (PostLangyControlFramesBodyFramesItemType0Workspace):
    """

    protocol: PostLangyControlFramesBodyFramesItemType0Protocol
    type_: PostLangyControlFramesBodyFramesItemType0Type
    cli: PostLangyControlFramesBodyFramesItemType0Cli
    instance: PostLangyControlFramesBodyFramesItemType0Instance
    workspace: PostLangyControlFramesBodyFramesItemType0Workspace

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
        protocol = PostLangyControlFramesBodyFramesItemType0Protocol(d.pop("protocol"))

        type_ = PostLangyControlFramesBodyFramesItemType0Type(d.pop("type"))

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

        return post_langy_control_frames_body_frames_item_type_0
