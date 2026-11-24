from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_governance_security_lake_sources_by_id_body_status import (
    PatchApiGovernanceSecurityLakeSourcesByIdBodyStatus,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_governance_security_lake_sources_by_id_body_config import (
        PatchApiGovernanceSecurityLakeSourcesByIdBodyConfig,
    )
    from ..models.patch_api_governance_security_lake_sources_by_id_body_credentials import (
        PatchApiGovernanceSecurityLakeSourcesByIdBodyCredentials,
    )


T = TypeVar("T", bound="PatchApiGovernanceSecurityLakeSourcesByIdBody")


@_attrs_define
class PatchApiGovernanceSecurityLakeSourcesByIdBody:
    """
    Attributes:
        name (str | Unset):
        description (None | str | Unset):
        config (PatchApiGovernanceSecurityLakeSourcesByIdBodyConfig | Unset):
        credentials (PatchApiGovernanceSecurityLakeSourcesByIdBodyCredentials | Unset):
        status (PatchApiGovernanceSecurityLakeSourcesByIdBodyStatus | Unset):
    """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    config: PatchApiGovernanceSecurityLakeSourcesByIdBodyConfig | Unset = UNSET
    credentials: PatchApiGovernanceSecurityLakeSourcesByIdBodyCredentials | Unset = UNSET
    status: PatchApiGovernanceSecurityLakeSourcesByIdBodyStatus | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.config, Unset):
            config = self.config.to_dict()

        credentials: dict[str, Any] | Unset = UNSET
        if not isinstance(self.credentials, Unset):
            credentials = self.credentials.to_dict()

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if config is not UNSET:
            field_dict["config"] = config
        if credentials is not UNSET:
            field_dict["credentials"] = credentials
        if status is not UNSET:
            field_dict["status"] = status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_governance_security_lake_sources_by_id_body_config import (
            PatchApiGovernanceSecurityLakeSourcesByIdBodyConfig,
        )
        from ..models.patch_api_governance_security_lake_sources_by_id_body_credentials import (
            PatchApiGovernanceSecurityLakeSourcesByIdBodyCredentials,
        )

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        _config = d.pop("config", UNSET)
        config: PatchApiGovernanceSecurityLakeSourcesByIdBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = PatchApiGovernanceSecurityLakeSourcesByIdBodyConfig.from_dict(_config)

        _credentials = d.pop("credentials", UNSET)
        credentials: PatchApiGovernanceSecurityLakeSourcesByIdBodyCredentials | Unset
        if isinstance(_credentials, Unset):
            credentials = UNSET
        else:
            credentials = PatchApiGovernanceSecurityLakeSourcesByIdBodyCredentials.from_dict(_credentials)

        _status = d.pop("status", UNSET)
        status: PatchApiGovernanceSecurityLakeSourcesByIdBodyStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = PatchApiGovernanceSecurityLakeSourcesByIdBodyStatus(_status)

        patch_api_governance_security_lake_sources_by_id_body = cls(
            name=name,
            description=description,
            config=config,
            credentials=credentials,
            status=status,
        )

        patch_api_governance_security_lake_sources_by_id_body.additional_properties = d
        return patch_api_governance_security_lake_sources_by_id_body

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
