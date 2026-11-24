from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_security_lake_sources_body_config import (
        PostApiGovernanceSecurityLakeSourcesBodyConfig,
    )
    from ..models.post_api_governance_security_lake_sources_body_credentials import (
        PostApiGovernanceSecurityLakeSourcesBodyCredentials,
    )


T = TypeVar("T", bound="PostApiGovernanceSecurityLakeSourcesBody")


@_attrs_define
class PostApiGovernanceSecurityLakeSourcesBody:
    """
    Attributes:
        name (str):
        config (PostApiGovernanceSecurityLakeSourcesBodyConfig):
        credentials (PostApiGovernanceSecurityLakeSourcesBodyCredentials):
        description (None | str | Unset):
    """

    name: str
    config: PostApiGovernanceSecurityLakeSourcesBodyConfig
    credentials: PostApiGovernanceSecurityLakeSourcesBodyCredentials
    description: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        config = self.config.to_dict()

        credentials = self.credentials.to_dict()

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "config": config,
                "credentials": credentials,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_security_lake_sources_body_config import (
            PostApiGovernanceSecurityLakeSourcesBodyConfig,
        )
        from ..models.post_api_governance_security_lake_sources_body_credentials import (
            PostApiGovernanceSecurityLakeSourcesBodyCredentials,
        )

        d = dict(src_dict)
        name = d.pop("name")

        config = PostApiGovernanceSecurityLakeSourcesBodyConfig.from_dict(d.pop("config"))

        credentials = PostApiGovernanceSecurityLakeSourcesBodyCredentials.from_dict(d.pop("credentials"))

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        post_api_governance_security_lake_sources_body = cls(
            name=name,
            config=config,
            credentials=credentials,
            description=description,
        )

        post_api_governance_security_lake_sources_body.additional_properties = d
        return post_api_governance_security_lake_sources_body

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
