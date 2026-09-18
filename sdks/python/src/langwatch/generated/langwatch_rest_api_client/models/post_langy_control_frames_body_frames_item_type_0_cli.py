from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostLangyControlFramesBodyFramesItemType0Cli")


@_attrs_define
class PostLangyControlFramesBodyFramesItemType0Cli:
    """
    Attributes:
        name (str):
        version (str):
    """

    name: str
    version: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        version = d.pop("version")

        post_langy_control_frames_body_frames_item_type_0_cli = cls(
            name=name,
            version=version,
        )

        return post_langy_control_frames_body_frames_item_type_0_cli
