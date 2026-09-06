from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
            PollConnectedAgentInstanceResponse200FramesItemType1]): The call and cancel frames waiting for the instance;
            empty once the poll wait passes with none.
    """

    frames: list[
        PollConnectedAgentInstanceResponse200FramesItemType0 | PollConnectedAgentInstanceResponse200FramesItemType1
    ]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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
        field_dict.update(self.additional_properties)
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

        poll_connected_agent_instance_response_200.additional_properties = d
        return poll_connected_agent_instance_response_200

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
