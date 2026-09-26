from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_0 import (
        PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0,
    )
    from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_1 import (
        PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType1,
    )


T = TypeVar("T", bound="PollLangyControlSessionResponse200FramesItemType2CallType2Params")


@_attrs_define
class PollLangyControlSessionResponse200FramesItemType2CallType2Params:
    """
    Attributes:
        path (str):
        edits (list[PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0 |
            PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType1]):
    """

    path: str
    edits: list[
        PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0
        | PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType1
    ]

    def to_dict(self) -> dict[str, Any]:
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_0 import (
            PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0,
        )

        path = self.path

        edits = []
        for edits_item_data in self.edits:
            edits_item: dict[str, Any]
            if isinstance(
                edits_item_data, PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0
            ):
                edits_item = edits_item_data.to_dict()
            else:
                edits_item = edits_item_data.to_dict()

            edits.append(edits_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "path": path,
                "edits": edits,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_0 import (
            PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0,
        )
        from ..models.poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params_edits_item_type_1 import (
            PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType1,
        )

        d = dict(src_dict)
        path = d.pop("path")

        edits = []
        _edits = d.pop("edits")
        for edits_item_data in _edits:

            def _parse_edits_item(
                data: object,
            ) -> (
                PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0
                | PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType1
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    edits_item_type_0 = (
                        PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType0.from_dict(data)
                    )

                    return edits_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                edits_item_type_1 = (
                    PollLangyControlSessionResponse200FramesItemType2CallType2ParamsEditsItemType1.from_dict(data)
                )

                return edits_item_type_1

            edits_item = _parse_edits_item(edits_item_data)

            edits.append(edits_item)

        poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params = cls(
            path=path,
            edits=edits,
        )

        return poll_langy_control_session_response_200_frames_item_type_2_call_type_2_params
