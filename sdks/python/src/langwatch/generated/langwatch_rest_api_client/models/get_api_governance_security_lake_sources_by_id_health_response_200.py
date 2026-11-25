from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_governance_security_lake_sources_by_id_health_response_200_health import (
        GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200Health,
    )


T = TypeVar("T", bound="GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200")


@_attrs_define
class GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200:
    """
    Attributes:
        source_id (str):
        status (str):
        last_error (None | str):
        health (GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200Health):
    """

    source_id: str
    status: str
    last_error: None | str
    health: GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200Health

    def to_dict(self) -> dict[str, Any]:
        source_id = self.source_id

        status = self.status

        last_error: None | str
        last_error = self.last_error

        health = self.health.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sourceId": source_id,
                "status": status,
                "lastError": last_error,
                "health": health,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_security_lake_sources_by_id_health_response_200_health import (
            GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200Health,
        )

        d = dict(src_dict)
        source_id = d.pop("sourceId")

        status = d.pop("status")

        def _parse_last_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_error = _parse_last_error(d.pop("lastError"))

        health = GetApiGovernanceSecurityLakeSourcesByIdHealthResponse200Health.from_dict(d.pop("health"))

        get_api_governance_security_lake_sources_by_id_health_response_200 = cls(
            source_id=source_id,
            status=status,
            last_error=last_error,
            health=health,
        )

        return get_api_governance_security_lake_sources_by_id_health_response_200
