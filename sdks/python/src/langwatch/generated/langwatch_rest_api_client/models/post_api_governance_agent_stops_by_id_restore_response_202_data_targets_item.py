from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_state import (
    PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemState,
)

if TYPE_CHECKING:
    from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_0 import (
        PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType0,
    )
    from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_1 import (
        PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType1,
    )
    from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_2 import (
        PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType2,
    )


T = TypeVar("T", bound="PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItem")


@_attrs_define
class PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItem:
    """
    Attributes:
        id (str):
        label (str):
        target (PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType0 |
            PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType1 |
            PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType2):
        state (PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemState):
        error_code (None | str):
        applied_at (None | str):
        reverted_at (None | str):
    """

    id: str
    label: str
    target: (
        PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType0
        | PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType1
        | PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType2
    )
    state: PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemState
    error_code: None | str
    applied_at: None | str
    reverted_at: None | str

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_0 import (
            PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType0,
        )
        from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_1 import (
            PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType1,
        )

        id = self.id

        label = self.label

        target: dict[str, Any]
        if isinstance(self.target, PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType0):
            target = self.target.to_dict()
        elif isinstance(self.target, PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType1):
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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_0 import (
            PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType0,
        )
        from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_1 import (
            PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType1,
        )
        from ..models.post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item_target_type_2 import (
            PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType2,
        )

        d = dict(src_dict)
        id = d.pop("id")

        label = d.pop("label")

        def _parse_target(
            data: object,
        ) -> (
            PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType0
            | PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType1
            | PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType2
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                target_type_0 = PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType0.from_dict(
                    data
                )

                return target_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                target_type_1 = PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType1.from_dict(
                    data
                )

                return target_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            target_type_2 = PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemTargetType2.from_dict(data)

            return target_type_2

        target = _parse_target(d.pop("target"))

        state = PostApiGovernanceAgentStopsByIdRestoreResponse202DataTargetsItemState(d.pop("state"))

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

        post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item = cls(
            id=id,
            label=label,
            target=target,
            state=state,
            error_code=error_code,
            applied_at=applied_at,
            reverted_at=reverted_at,
        )

        return post_api_governance_agent_stops_by_id_restore_response_202_data_targets_item
