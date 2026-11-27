from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_governance_agents_by_id_stop_body_severity import PostApiGovernanceAgentsByIdStopBodySeverity
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGovernanceAgentsByIdStopBody")


@_attrs_define
class PostApiGovernanceAgentsByIdStopBody:
    """
    Attributes:
        reason (str):
        severity (PostApiGovernanceAgentsByIdStopBodySeverity | Unset):  Default:
            PostApiGovernanceAgentsByIdStopBodySeverity.HIGH.
        expected_target_ids (list[str] | Unset):
    """

    reason: str
    severity: PostApiGovernanceAgentsByIdStopBodySeverity | Unset = PostApiGovernanceAgentsByIdStopBodySeverity.HIGH
    expected_target_ids: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason

        severity: str | Unset = UNSET
        if not isinstance(self.severity, Unset):
            severity = self.severity.value

        expected_target_ids: list[str] | Unset = UNSET
        if not isinstance(self.expected_target_ids, Unset):
            expected_target_ids = self.expected_target_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "reason": reason,
            }
        )
        if severity is not UNSET:
            field_dict["severity"] = severity
        if expected_target_ids is not UNSET:
            field_dict["expectedTargetIds"] = expected_target_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = d.pop("reason")

        _severity = d.pop("severity", UNSET)
        severity: PostApiGovernanceAgentsByIdStopBodySeverity | Unset
        if isinstance(_severity, Unset):
            severity = UNSET
        else:
            severity = PostApiGovernanceAgentsByIdStopBodySeverity(_severity)

        expected_target_ids = cast(list[str], d.pop("expectedTargetIds", UNSET))

        post_api_governance_agents_by_id_stop_body = cls(
            reason=reason,
            severity=severity,
            expected_target_ids=expected_target_ids,
        )

        post_api_governance_agents_by_id_stop_body.additional_properties = d
        return post_api_governance_agents_by_id_stop_body

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
