from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200HealthPoisonItem")


@_attrs_define
class GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200HealthPoisonItem:
    """
    Attributes:
        message_id (str):
        key (str):
        reason (str):
        at (float):
    """

    message_id: str
    key: str
    reason: str
    at: float

    def to_dict(self) -> dict[str, Any]:
        message_id = self.message_id

        key = self.key

        reason = self.reason

        at = self.at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "messageId": message_id,
                "key": key,
                "reason": reason,
                "at": at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message_id = d.pop("messageId")

        key = d.pop("key")

        reason = d.pop("reason")

        at = d.pop("at")

        get_api_governance_security_lake_sources_by_id_health_response_200_health_poison_item = cls(
            message_id=message_id,
            key=key,
            reason=reason,
            at=at,
        )

        return get_api_governance_security_lake_sources_by_id_health_response_200_health_poison_item
