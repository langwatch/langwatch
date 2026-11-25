from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGovernanceAgentStopsByIdApproveBody")


@_attrs_define
class PostApiGovernanceAgentStopsByIdApproveBody:
    """
    Attributes:
        note (str | Unset):
        expected_target_ids (list[str] | Unset):
    """

    note: str | Unset = UNSET
    expected_target_ids: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        note = self.note

        expected_target_ids: list[str] | Unset = UNSET
        if not isinstance(self.expected_target_ids, Unset):
            expected_target_ids = self.expected_target_ids

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if note is not UNSET:
            field_dict["note"] = note
        if expected_target_ids is not UNSET:
            field_dict["expectedTargetIds"] = expected_target_ids

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        note = d.pop("note", UNSET)

        expected_target_ids = cast(list[str], d.pop("expectedTargetIds", UNSET))

        post_api_governance_agent_stops_by_id_approve_body = cls(
            note=note,
            expected_target_ids=expected_target_ids,
        )

        post_api_governance_agent_stops_by_id_approve_body.additional_properties = d
        return post_api_governance_agent_stops_by_id_approve_body

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
