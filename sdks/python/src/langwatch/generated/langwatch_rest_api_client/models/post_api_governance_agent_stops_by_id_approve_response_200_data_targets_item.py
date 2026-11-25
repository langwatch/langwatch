from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_state import (
    PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemState,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_target_type_0 import (
        PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType0,
    )
    from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_target_type_1 import (
        PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType1,
    )
    from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_target_type_2 import (
        PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType2,
    )


T = TypeVar("T", bound="PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItem")


@_attrs_define
class PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItem:
    """
    Attributes:
        id (str):
        label (str):
        target (PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType0 |
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType1 |
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType2):
        state (PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemState):
        error_code (None | str):
        applied_at (None | str):
        reverted_at (None | str):
        already_stopped (bool | Unset):
        gone (bool | Unset):
        kept_disabled (bool | Unset):
        dropped (bool | Unset):
        drop_id (str | Unset):
    """

    id: str
    label: str
    target: (
        PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType0
        | PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType1
        | PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType2
    )
    state: PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemState
    error_code: None | str
    applied_at: None | str
    reverted_at: None | str
    already_stopped: bool | Unset = UNSET
    gone: bool | Unset = UNSET
    kept_disabled: bool | Unset = UNSET
    dropped: bool | Unset = UNSET
    drop_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_target_type_0 import (
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType0,
        )
        from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_target_type_1 import (
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType1,
        )

        id = self.id

        label = self.label

        target: dict[str, Any]
        if isinstance(self.target, PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType0):
            target = self.target.to_dict()
        elif isinstance(self.target, PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType1):
            target = self.target.to_dict()
        else:
            target = self.target.to_dict()

        state = self.state.value

        error_code: None | str
        error_code = self.error_code

        applied_at: None | str
        applied_at = self.applied_at

        reverted_at: None | str
        reverted_at = self.reverted_at

        already_stopped = self.already_stopped

        gone = self.gone

        kept_disabled = self.kept_disabled

        dropped = self.dropped

        drop_id = self.drop_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "label": label,
                "target": target,
                "state": state,
                "errorCode": error_code,
                "appliedAt": applied_at,
                "revertedAt": reverted_at,
            }
        )
        if already_stopped is not UNSET:
            field_dict["alreadyStopped"] = already_stopped
        if gone is not UNSET:
            field_dict["gone"] = gone
        if kept_disabled is not UNSET:
            field_dict["keptDisabled"] = kept_disabled
        if dropped is not UNSET:
            field_dict["dropped"] = dropped
        if drop_id is not UNSET:
            field_dict["dropId"] = drop_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_target_type_0 import (
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType0,
        )
        from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_target_type_1 import (
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType1,
        )
        from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item_target_type_2 import (
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType2,
        )

        d = dict(src_dict)
        id = d.pop("id")

        label = d.pop("label")

        def _parse_target(
            data: object,
        ) -> (
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType0
            | PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType1
            | PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                target_type_0 = PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType0.from_dict(
                    data
                )

                return target_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                target_type_1 = PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType1.from_dict(
                    data
                )

                return target_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            target_type_2 = PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemTargetType2.from_dict(data)

            return target_type_2

        target = _parse_target(d.pop("target"))

        state = PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItemState(d.pop("state"))

        def _parse_error_code(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error_code = _parse_error_code(d.pop("errorCode"))

        def _parse_applied_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        applied_at = _parse_applied_at(d.pop("appliedAt"))

        def _parse_reverted_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reverted_at = _parse_reverted_at(d.pop("revertedAt"))

        already_stopped = d.pop("alreadyStopped", UNSET)

        gone = d.pop("gone", UNSET)

        kept_disabled = d.pop("keptDisabled", UNSET)

        dropped = d.pop("dropped", UNSET)

        drop_id = d.pop("dropId", UNSET)

        post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item = cls(
            id=id,
            label=label,
            target=target,
            state=state,
            error_code=error_code,
            applied_at=applied_at,
            reverted_at=reverted_at,
            already_stopped=already_stopped,
            gone=gone,
            kept_disabled=kept_disabled,
            dropped=dropped,
            drop_id=drop_id,
        )

        return post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item
