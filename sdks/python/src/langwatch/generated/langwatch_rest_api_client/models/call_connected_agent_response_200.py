from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.call_connected_agent_response_200_instance import CallConnectedAgentResponse200Instance
    from ..models.call_connected_agent_response_200_output_type_1 import CallConnectedAgentResponse200OutputType1
    from ..models.call_connected_agent_response_200_output_type_2_item import (
        CallConnectedAgentResponse200OutputType2Item,
    )
    from ..models.call_connected_agent_response_200_state_type_0 import CallConnectedAgentResponse200StateType0


T = TypeVar("T", bound="CallConnectedAgentResponse200")


@_attrs_define
class CallConnectedAgentResponse200:
    """
    Attributes:
        output (CallConnectedAgentResponse200OutputType1 | list[CallConnectedAgentResponse200OutputType2Item] | str):
            What the function answered: text, one message, or a list of messages.
        instance (CallConnectedAgentResponse200Instance):
        duration_ms (float):
        session (Any | Unset): The agent's per-conversation memory, to send on the next turn.
        state (CallConnectedAgentResponse200StateType0 | None | Unset): Setup's state, a turn's state update, or the
            object teardown returned.
    """

    output: CallConnectedAgentResponse200OutputType1 | list[CallConnectedAgentResponse200OutputType2Item] | str
    instance: CallConnectedAgentResponse200Instance
    duration_ms: float
    session: Any | Unset = UNSET
    state: CallConnectedAgentResponse200StateType0 | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.call_connected_agent_response_200_output_type_1 import CallConnectedAgentResponse200OutputType1
        from ..models.call_connected_agent_response_200_state_type_0 import CallConnectedAgentResponse200StateType0

        output: dict[str, Any] | list[dict[str, Any]] | str
        if isinstance(self.output, CallConnectedAgentResponse200OutputType1):
            output = self.output.to_dict()
        elif isinstance(self.output, list):
            output = []
            for output_type_2_item_data in self.output:
                output_type_2_item = output_type_2_item_data.to_dict()
                output.append(output_type_2_item)

        else:
            output = self.output

        instance = self.instance.to_dict()

        duration_ms = self.duration_ms

        session = self.session

        state: dict[str, Any] | None | Unset
        if isinstance(self.state, Unset):
            state = UNSET
        elif isinstance(self.state, CallConnectedAgentResponse200StateType0):
            state = self.state.to_dict()
        else:
            state = self.state

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "output": output,
                "instance": instance,
                "durationMs": duration_ms,
            }
        )
        if session is not UNSET:
            field_dict["session"] = session
        if state is not UNSET:
            field_dict["state"] = state

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.call_connected_agent_response_200_instance import CallConnectedAgentResponse200Instance
        from ..models.call_connected_agent_response_200_output_type_1 import CallConnectedAgentResponse200OutputType1
        from ..models.call_connected_agent_response_200_output_type_2_item import (
            CallConnectedAgentResponse200OutputType2Item,
        )
        from ..models.call_connected_agent_response_200_state_type_0 import CallConnectedAgentResponse200StateType0

        d = dict(src_dict)

        def _parse_output(
            data: object,
        ) -> CallConnectedAgentResponse200OutputType1 | list[CallConnectedAgentResponse200OutputType2Item] | str:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                output_type_1 = CallConnectedAgentResponse200OutputType1.from_dict(data)

                return output_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, list):
                    raise TypeError()
                output_type_2 = []
                _output_type_2 = data
                for output_type_2_item_data in _output_type_2:
                    output_type_2_item = CallConnectedAgentResponse200OutputType2Item.from_dict(output_type_2_item_data)

                    output_type_2.append(output_type_2_item)

                return output_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                CallConnectedAgentResponse200OutputType1 | list[CallConnectedAgentResponse200OutputType2Item] | str,
                data,
            )

        output = _parse_output(d.pop("output"))

        instance = CallConnectedAgentResponse200Instance.from_dict(d.pop("instance"))

        duration_ms = d.pop("durationMs")

        session = d.pop("session", UNSET)

        def _parse_state(data: object) -> CallConnectedAgentResponse200StateType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                state_type_0 = CallConnectedAgentResponse200StateType0.from_dict(data)

                return state_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(CallConnectedAgentResponse200StateType0 | None | Unset, data)

        state = _parse_state(d.pop("state", UNSET))

        call_connected_agent_response_200 = cls(
            output=output,
            instance=instance,
            duration_ms=duration_ms,
            session=session,
            state=state,
        )

        return call_connected_agent_response_200
