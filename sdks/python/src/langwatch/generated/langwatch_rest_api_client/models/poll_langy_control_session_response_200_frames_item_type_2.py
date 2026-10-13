from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_0 import (
        PollLangyControlSessionResponse200FramesItemType2CallType0,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_1 import (
        PollLangyControlSessionResponse200FramesItemType2CallType1,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_2 import (
        PollLangyControlSessionResponse200FramesItemType2CallType2,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_3 import (
        PollLangyControlSessionResponse200FramesItemType2CallType3,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_4 import (
        PollLangyControlSessionResponse200FramesItemType2CallType4,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_5 import (
        PollLangyControlSessionResponse200FramesItemType2CallType5,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_6 import (
        PollLangyControlSessionResponse200FramesItemType2CallType6,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_7 import (
        PollLangyControlSessionResponse200FramesItemType2CallType7,
    )


T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2:
    """
    Attributes:
        protocol (Literal[1]):
        type_ (Literal['call']):
        call (PollLangyControlSessionResponse200FramesItemType2CallType0 |
            PollLangyControlSessionResponse200FramesItemType2CallType1 |
            PollLangyControlSessionResponse200FramesItemType2CallType2 |
            PollLangyControlSessionResponse200FramesItemType2CallType3 |
            PollLangyControlSessionResponse200FramesItemType2CallType4 |
            PollLangyControlSessionResponse200FramesItemType2CallType5 |
            PollLangyControlSessionResponse200FramesItemType2CallType6 |
            PollLangyControlSessionResponse200FramesItemType2CallType7):
    """

    protocol: Literal[1]
    type_: Literal["call"]
    call: (
        PollLangyControlSessionResponse200FramesItemType2CallType0
        | PollLangyControlSessionResponse200FramesItemType2CallType1
        | PollLangyControlSessionResponse200FramesItemType2CallType2
        | PollLangyControlSessionResponse200FramesItemType2CallType3
        | PollLangyControlSessionResponse200FramesItemType2CallType4
        | PollLangyControlSessionResponse200FramesItemType2CallType5
        | PollLangyControlSessionResponse200FramesItemType2CallType6
        | PollLangyControlSessionResponse200FramesItemType2CallType7
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_0 import (
            PollLangyControlSessionResponse200FramesItemType2CallType0,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_1 import (
            PollLangyControlSessionResponse200FramesItemType2CallType1,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_2 import (
            PollLangyControlSessionResponse200FramesItemType2CallType2,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_3 import (
            PollLangyControlSessionResponse200FramesItemType2CallType3,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_4 import (
            PollLangyControlSessionResponse200FramesItemType2CallType4,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_5 import (
            PollLangyControlSessionResponse200FramesItemType2CallType5,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_6 import (
            PollLangyControlSessionResponse200FramesItemType2CallType6,
        )

        protocol = self.protocol

        type_ = self.type_

        call: dict[str, Any]
        if isinstance(self.call, PollLangyControlSessionResponse200FramesItemType2CallType0):
            call = self.call.to_dict()
        elif isinstance(self.call, PollLangyControlSessionResponse200FramesItemType2CallType1):
            call = self.call.to_dict()
        elif isinstance(self.call, PollLangyControlSessionResponse200FramesItemType2CallType2):
            call = self.call.to_dict()
        elif isinstance(self.call, PollLangyControlSessionResponse200FramesItemType2CallType3):
            call = self.call.to_dict()
        elif isinstance(self.call, PollLangyControlSessionResponse200FramesItemType2CallType4):
            call = self.call.to_dict()
        elif isinstance(self.call, PollLangyControlSessionResponse200FramesItemType2CallType5):
            call = self.call.to_dict()
        elif isinstance(self.call, PollLangyControlSessionResponse200FramesItemType2CallType6):
            call = self.call.to_dict()
        else:
            call = self.call.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "protocol": protocol,
                "type": type_,
                "call": call,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_0 import (
            PollLangyControlSessionResponse200FramesItemType2CallType0,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_1 import (
            PollLangyControlSessionResponse200FramesItemType2CallType1,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_2 import (
            PollLangyControlSessionResponse200FramesItemType2CallType2,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_3 import (
            PollLangyControlSessionResponse200FramesItemType2CallType3,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_4 import (
            PollLangyControlSessionResponse200FramesItemType2CallType4,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_5 import (
            PollLangyControlSessionResponse200FramesItemType2CallType5,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_6 import (
            PollLangyControlSessionResponse200FramesItemType2CallType6,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_7 import (
            PollLangyControlSessionResponse200FramesItemType2CallType7,
        )

        d = dict(src_dict)
        protocol = cast(Literal[1], d.pop("protocol"))
        if protocol != 1:
            raise ValueError(f"protocol must match const 1, got '{protocol}'")

        type_ = cast(Literal["call"], d.pop("type"))
        if type_ != "call":
            raise ValueError(f"type must match const 'call', got '{type_}'")

        def _parse_call(
            data: object,
        ) -> (
            PollLangyControlSessionResponse200FramesItemType2CallType0
            | PollLangyControlSessionResponse200FramesItemType2CallType1
            | PollLangyControlSessionResponse200FramesItemType2CallType2
            | PollLangyControlSessionResponse200FramesItemType2CallType3
            | PollLangyControlSessionResponse200FramesItemType2CallType4
            | PollLangyControlSessionResponse200FramesItemType2CallType5
            | PollLangyControlSessionResponse200FramesItemType2CallType6
            | PollLangyControlSessionResponse200FramesItemType2CallType7
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                call_type_0 = PollLangyControlSessionResponse200FramesItemType2CallType0.from_dict(data)

                return call_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                call_type_1 = PollLangyControlSessionResponse200FramesItemType2CallType1.from_dict(data)

                return call_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                call_type_2 = PollLangyControlSessionResponse200FramesItemType2CallType2.from_dict(data)

                return call_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                call_type_3 = PollLangyControlSessionResponse200FramesItemType2CallType3.from_dict(data)

                return call_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                call_type_4 = PollLangyControlSessionResponse200FramesItemType2CallType4.from_dict(data)

                return call_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                call_type_5 = PollLangyControlSessionResponse200FramesItemType2CallType5.from_dict(data)

                return call_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                call_type_6 = PollLangyControlSessionResponse200FramesItemType2CallType6.from_dict(data)

                return call_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            call_type_7 = PollLangyControlSessionResponse200FramesItemType2CallType7.from_dict(data)

            return call_type_7

        call = _parse_call(d.pop("call"))

        poll_langy_control_session_response_200_frames_item_type_2 = cls(
            protocol=protocol,
            type_=type_,
            call=call,
        )

        return poll_langy_control_session_response_200_frames_item_type_2
