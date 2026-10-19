from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_connected_agent_frames_body_frames_item_type_0 import PostConnectedAgentFramesBodyFramesItemType0
    from ..models.post_connected_agent_frames_body_frames_item_type_1 import PostConnectedAgentFramesBodyFramesItemType1
    from ..models.post_connected_agent_frames_body_frames_item_type_2 import PostConnectedAgentFramesBodyFramesItemType2


T = TypeVar("T", bound="PostConnectedAgentFramesBody")


@_attrs_define
class PostConnectedAgentFramesBody:
    """
    Attributes:
        frames (list[PostConnectedAgentFramesBodyFramesItemType0 | PostConnectedAgentFramesBodyFramesItemType1 |
            PostConnectedAgentFramesBodyFramesItemType2]):
    """

    frames: list[
        PostConnectedAgentFramesBodyFramesItemType0
        | PostConnectedAgentFramesBodyFramesItemType1
        | PostConnectedAgentFramesBodyFramesItemType2
    ]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_connected_agent_frames_body_frames_item_type_0 import (
            PostConnectedAgentFramesBodyFramesItemType0,
        )
        from ..models.post_connected_agent_frames_body_frames_item_type_1 import (
            PostConnectedAgentFramesBodyFramesItemType1,
        )

        frames = []
        for frames_item_data in self.frames:
            frames_item: dict[str, Any]
            if isinstance(frames_item_data, PostConnectedAgentFramesBodyFramesItemType0):
                frames_item = frames_item_data.to_dict()
            elif isinstance(frames_item_data, PostConnectedAgentFramesBodyFramesItemType1):
                frames_item = frames_item_data.to_dict()
            else:
                frames_item = frames_item_data.to_dict()

            frames.append(frames_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "frames": frames,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_connected_agent_frames_body_frames_item_type_0 import (
            PostConnectedAgentFramesBodyFramesItemType0,
        )
        from ..models.post_connected_agent_frames_body_frames_item_type_1 import (
            PostConnectedAgentFramesBodyFramesItemType1,
        )
        from ..models.post_connected_agent_frames_body_frames_item_type_2 import (
            PostConnectedAgentFramesBodyFramesItemType2,
        )

        d = dict(src_dict)
        frames = []
        _frames = d.pop("frames")
        for frames_item_data in _frames:

            def _parse_frames_item(
                data: object,
            ) -> (
                PostConnectedAgentFramesBodyFramesItemType0
                | PostConnectedAgentFramesBodyFramesItemType1
                | PostConnectedAgentFramesBodyFramesItemType2
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_0 = PostConnectedAgentFramesBodyFramesItemType0.from_dict(data)

                    return frames_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_1 = PostConnectedAgentFramesBodyFramesItemType1.from_dict(data)

                    return frames_item_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                frames_item_type_2 = PostConnectedAgentFramesBodyFramesItemType2.from_dict(data)

                return frames_item_type_2

            frames_item = _parse_frames_item(frames_item_data)

            frames.append(frames_item)

        post_connected_agent_frames_body = cls(
            frames=frames,
        )

        post_connected_agent_frames_body.additional_properties = d
        return post_connected_agent_frames_body

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
