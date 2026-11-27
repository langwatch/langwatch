from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_approval import (
    PostApiGovernanceAgentStopsByIdApproveResponse200DataApproval,
)
from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_severity import (
    PostApiGovernanceAgentStopsByIdApproveResponse200DataSeverity,
)
from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_status import (
    PostApiGovernanceAgentStopsByIdApproveResponse200DataStatus,
)
from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_trigger import (
    PostApiGovernanceAgentStopsByIdApproveResponse200DataTrigger,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_requested_by import (
        PostApiGovernanceAgentStopsByIdApproveResponse200DataRequestedBy,
    )
    from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item import (
        PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItem,
    )


T = TypeVar("T", bound="PostApiGovernanceAgentStopsByIdApproveResponse200Data")


@_attrs_define
class PostApiGovernanceAgentStopsByIdApproveResponse200Data:
    """
    Attributes:
        id (str):
        agent_id (str):
        agent_name (str):
        status (PostApiGovernanceAgentStopsByIdApproveResponse200DataStatus):
        severity (PostApiGovernanceAgentStopsByIdApproveResponse200DataSeverity):
        approval (PostApiGovernanceAgentStopsByIdApproveResponse200DataApproval):
        trigger (PostApiGovernanceAgentStopsByIdApproveResponse200DataTrigger):
        reason (str):
        requested_by (PostApiGovernanceAgentStopsByIdApproveResponse200DataRequestedBy):
        decided_by_user_id (None | str):
        restored_by_user_id (None | str):
        targets (list[PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItem]):
        requested_at (str):
        decided_at (None | str):
        quarantined_at (None | str):
        restore_requested_at (None | str):
        restored_at (None | str):
        last_request_id (str | Unset):
    """

    id: str
    agent_id: str
    agent_name: str
    status: PostApiGovernanceAgentStopsByIdApproveResponse200DataStatus
    severity: PostApiGovernanceAgentStopsByIdApproveResponse200DataSeverity
    approval: PostApiGovernanceAgentStopsByIdApproveResponse200DataApproval
    trigger: PostApiGovernanceAgentStopsByIdApproveResponse200DataTrigger
    reason: str
    requested_by: PostApiGovernanceAgentStopsByIdApproveResponse200DataRequestedBy
    decided_by_user_id: None | str
    restored_by_user_id: None | str
    targets: list[PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItem]
    requested_at: str
    decided_at: None | str
    quarantined_at: None | str
    restore_requested_at: None | str
    restored_at: None | str
    last_request_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        agent_id = self.agent_id

        agent_name = self.agent_name

        status = self.status.value

        severity = self.severity.value

        approval = self.approval.value

        trigger = self.trigger.value

        reason = self.reason

        requested_by = self.requested_by.to_dict()

        decided_by_user_id: None | str
        decided_by_user_id = self.decided_by_user_id

        restored_by_user_id: None | str
        restored_by_user_id = self.restored_by_user_id

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)

        requested_at = self.requested_at

        decided_at: None | str
        decided_at = self.decided_at

        quarantined_at: None | str
        quarantined_at = self.quarantined_at

        restore_requested_at: None | str
        restore_requested_at = self.restore_requested_at

        restored_at: None | str
        restored_at = self.restored_at

        last_request_id = self.last_request_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "agentId": agent_id,
                "agentName": agent_name,
                "status": status,
                "severity": severity,
                "approval": approval,
                "trigger": trigger,
                "reason": reason,
                "requestedBy": requested_by,
                "decidedByUserId": decided_by_user_id,
                "restoredByUserId": restored_by_user_id,
                "targets": targets,
                "requestedAt": requested_at,
                "decidedAt": decided_at,
                "quarantinedAt": quarantined_at,
                "restoreRequestedAt": restore_requested_at,
                "restoredAt": restored_at,
            }
        )
        if last_request_id is not UNSET:
            field_dict["lastRequestId"] = last_request_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_requested_by import (
            PostApiGovernanceAgentStopsByIdApproveResponse200DataRequestedBy,
        )
        from ..models.post_api_governance_agent_stops_by_id_approve_response_200_data_targets_item import (
            PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        agent_id = d.pop("agentId")

        agent_name = d.pop("agentName")

        status = PostApiGovernanceAgentStopsByIdApproveResponse200DataStatus(d.pop("status"))

        severity = PostApiGovernanceAgentStopsByIdApproveResponse200DataSeverity(d.pop("severity"))

        approval = PostApiGovernanceAgentStopsByIdApproveResponse200DataApproval(d.pop("approval"))

        trigger = PostApiGovernanceAgentStopsByIdApproveResponse200DataTrigger(d.pop("trigger"))

        reason = d.pop("reason")

        requested_by = PostApiGovernanceAgentStopsByIdApproveResponse200DataRequestedBy.from_dict(d.pop("requestedBy"))

        def _parse_decided_by_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        decided_by_user_id = _parse_decided_by_user_id(d.pop("decidedByUserId"))

        def _parse_restored_by_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        restored_by_user_id = _parse_restored_by_user_id(d.pop("restoredByUserId"))

        targets = []
        _targets = d.pop("targets")
        for targets_item_data in _targets:
            targets_item = PostApiGovernanceAgentStopsByIdApproveResponse200DataTargetsItem.from_dict(targets_item_data)

            targets.append(targets_item)

        requested_at = d.pop("requestedAt")

        def _parse_decided_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        decided_at = _parse_decided_at(d.pop("decidedAt"))

        def _parse_quarantined_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        quarantined_at = _parse_quarantined_at(d.pop("quarantinedAt"))

        def _parse_restore_requested_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        restore_requested_at = _parse_restore_requested_at(d.pop("restoreRequestedAt"))

        def _parse_restored_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        restored_at = _parse_restored_at(d.pop("restoredAt"))

        last_request_id = d.pop("lastRequestId", UNSET)

        post_api_governance_agent_stops_by_id_approve_response_200_data = cls(
            id=id,
            agent_id=agent_id,
            agent_name=agent_name,
            status=status,
            severity=severity,
            approval=approval,
            trigger=trigger,
            reason=reason,
            requested_by=requested_by,
            decided_by_user_id=decided_by_user_id,
            restored_by_user_id=restored_by_user_id,
            targets=targets,
            requested_at=requested_at,
            decided_at=decided_at,
            quarantined_at=quarantined_at,
            restore_requested_at=restore_requested_at,
            restored_at=restored_at,
            last_request_id=last_request_id,
        )

        return post_api_governance_agent_stops_by_id_approve_response_200_data
