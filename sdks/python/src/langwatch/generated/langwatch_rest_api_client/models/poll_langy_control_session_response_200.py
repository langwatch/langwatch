from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.poll_langy_control_session_response_200_frames_item_type_0 import (
        PollLangyControlSessionResponse200FramesItemType0,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_1 import (
        PollLangyControlSessionResponse200FramesItemType1,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2 import (
        PollLangyControlSessionResponse200FramesItemType2,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_3 import (
        PollLangyControlSessionResponse200FramesItemType3,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_4 import (
        PollLangyControlSessionResponse200FramesItemType4,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_5 import (
        PollLangyControlSessionResponse200FramesItemType5,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_6 import (
        PollLangyControlSessionResponse200FramesItemType6,
    )


T = TypeVar("T", bound="PollLangyControlSessionResponse200")


@_attrs_define
class PollLangyControlSessionResponse200:
    """
    Attributes:
        frames (list[PollLangyControlSessionResponse200FramesItemType0 |
            PollLangyControlSessionResponse200FramesItemType1 | PollLangyControlSessionResponse200FramesItemType2 |
            PollLangyControlSessionResponse200FramesItemType3 | PollLangyControlSessionResponse200FramesItemType4 |
            PollLangyControlSessionResponse200FramesItemType5 | PollLangyControlSessionResponse200FramesItemType6]): The
            frames waiting for the folder; empty once the poll wait passes with none.
    """

    frames: list[
        PollLangyControlSessionResponse200FramesItemType0
        | PollLangyControlSessionResponse200FramesItemType1
        | PollLangyControlSessionResponse200FramesItemType2
        | PollLangyControlSessionResponse200FramesItemType3
        | PollLangyControlSessionResponse200FramesItemType4
        | PollLangyControlSessionResponse200FramesItemType5
        | PollLangyControlSessionResponse200FramesItemType6
    ]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.poll_langy_control_session_response_200_frames_item_type_0 import (
            PollLangyControlSessionResponse200FramesItemType0,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_1 import (
            PollLangyControlSessionResponse200FramesItemType1,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2 import (
            PollLangyControlSessionResponse200FramesItemType2,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_3 import (
            PollLangyControlSessionResponse200FramesItemType3,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_4 import (
            PollLangyControlSessionResponse200FramesItemType4,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_5 import (
            PollLangyControlSessionResponse200FramesItemType5,
        )

        frames = []
        for frames_item_data in self.frames:
            frames_item: dict[str, Any]
            if isinstance(frames_item_data, PollLangyControlSessionResponse200FramesItemType0):
                frames_item = frames_item_data.to_dict()
            elif isinstance(frames_item_data, PollLangyControlSessionResponse200FramesItemType1):
                frames_item = frames_item_data.to_dict()
            elif isinstance(frames_item_data, PollLangyControlSessionResponse200FramesItemType2):
                frames_item = frames_item_data.to_dict()
            elif isinstance(frames_item_data, PollLangyControlSessionResponse200FramesItemType3):
                frames_item = frames_item_data.to_dict()
            elif isinstance(frames_item_data, PollLangyControlSessionResponse200FramesItemType4):
                frames_item = frames_item_data.to_dict()
            elif isinstance(frames_item_data, PollLangyControlSessionResponse200FramesItemType5):
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
        from ..models.poll_langy_control_session_response_200_frames_item_type_0 import (
            PollLangyControlSessionResponse200FramesItemType0,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_1 import (
            PollLangyControlSessionResponse200FramesItemType1,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2 import (
            PollLangyControlSessionResponse200FramesItemType2,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_3 import (
            PollLangyControlSessionResponse200FramesItemType3,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_4 import (
            PollLangyControlSessionResponse200FramesItemType4,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_5 import (
            PollLangyControlSessionResponse200FramesItemType5,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_6 import (
            PollLangyControlSessionResponse200FramesItemType6,
        )

        d = dict(src_dict)
        frames = []
        _frames = d.pop("frames")
        for frames_item_data in _frames:

            def _parse_frames_item(
                data: object,
            ) -> (
                PollLangyControlSessionResponse200FramesItemType0
                | PollLangyControlSessionResponse200FramesItemType1
                | PollLangyControlSessionResponse200FramesItemType2
                | PollLangyControlSessionResponse200FramesItemType3
                | PollLangyControlSessionResponse200FramesItemType4
                | PollLangyControlSessionResponse200FramesItemType5
                | PollLangyControlSessionResponse200FramesItemType6
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_0 = PollLangyControlSessionResponse200FramesItemType0.from_dict(data)

                    return frames_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_1 = PollLangyControlSessionResponse200FramesItemType1.from_dict(data)

                    return frames_item_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_2 = PollLangyControlSessionResponse200FramesItemType2.from_dict(data)

                    return frames_item_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_3 = PollLangyControlSessionResponse200FramesItemType3.from_dict(data)

                    return frames_item_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_4 = PollLangyControlSessionResponse200FramesItemType4.from_dict(data)

                    return frames_item_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    frames_item_type_5 = PollLangyControlSessionResponse200FramesItemType5.from_dict(data)

                    return frames_item_type_5
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                frames_item_type_6 = PollLangyControlSessionResponse200FramesItemType6.from_dict(data)

                return frames_item_type_6

            frames_item = _parse_frames_item(frames_item_data)

            frames.append(frames_item)

        poll_langy_control_session_response_200 = cls(
            frames=frames,
        )

        poll_langy_control_session_response_200.additional_properties = d
        return poll_langy_control_session_response_200

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
