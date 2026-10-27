from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.poll_connected_agent_instance_response_200_frames_item_type_0 import (
        PollConnectedAgentInstanceResponse200FramesItemType0,
    )
    from ..models.poll_connected_agent_instance_response_200_frames_item_type_1 import (
        PollConnectedAgentInstanceResponse200FramesItemType1,
    )


T = TypeVar("T", bound="PollConnectedAgentInstanceResponse200")


@_attrs_define
class PollConnectedAgentInstanceResponse200:
    """
    Attributes:
        frames (list[PollConnectedAgentInstanceResponse200FramesItemType0 |
            PollConnectedAgentInstanceResponse200FramesItemType1]):
    """

    frames: list[
        PollConnectedAgentInstanceResponse200FramesItemType0 | PollConnectedAgentInstanceResponse200FramesItemType1
    ]

    def to_dict(self) -> dict[str, Any]:
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_0 import (
            PollConnectedAgentInstanceResponse200FramesItemType0,
        )

        frames = []
        for frames_item_data in self.frames:
            frames_item: dict[str, Any]
            if isinstance(frames_item_data, PollConnectedAgentInstanceResponse200FramesItemType0):
                frames_item = frames_item_data.to_dict()
            else:
                frames_item = frames_item_data.to_dict()

            frames.append(frames_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "frames": frames,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_0 import (
            PollConnectedAgentInstanceResponse200FramesItemType0,
        )
        from ..models.poll_connected_agent_instance_response_200_frames_item_type_1 import (
            PollConnectedAgentInstanceResponse200FramesItemType1,
        )

        d = dict(src_dict)
        frames = []
        _frames = d.pop("frames")
        for frames_item_data in _frames:

            def _parse_frames_item(
                data: object,
            ) -> (
                PollConnectedAgentInstanceResponse200FramesItemType0
                | PollConnectedAgentInstanceResponse200FramesItemType1
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_0 = PollConnectedAgentInstanceResponse200FramesItemType0.from_dict(data)

                    return frames_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                frames_item_type_1 = PollConnectedAgentInstanceResponse200FramesItemType1.from_dict(data)

                return frames_item_type_1

            frames_item = _parse_frames_item(frames_item_data)

            frames.append(frames_item)

        poll_connected_agent_instance_response_200 = cls(
            frames=frames,
        )

        return poll_connected_agent_instance_response_200
