from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_security_lake_sources_by_id_test_body_config import (
        PostApiGovernanceSecurityLakeSourcesByIdTestBodyConfig,
    )
    from ..models.post_api_governance_security_lake_sources_by_id_test_body_credentials import (
        PostApiGovernanceSecurityLakeSourcesByIdTestBodyCredentials,
    )


T = TypeVar("T", bound="PostApiGovernanceSecurityLakeSourcesByIdTestBody")


@_attrs_define
class PostApiGovernanceSecurityLakeSourcesByIdTestBody:
    """
    Attributes:
        config (PostApiGovernanceSecurityLakeSourcesByIdTestBodyConfig | Unset):
        credentials (PostApiGovernanceSecurityLakeSourcesByIdTestBodyCredentials | Unset):
    """

    config: PostApiGovernanceSecurityLakeSourcesByIdTestBodyConfig | Unset = UNSET
    credentials: PostApiGovernanceSecurityLakeSourcesByIdTestBodyCredentials | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.config, Unset):
            config = self.config.to_dict()

        credentials: dict[str, Any] | Unset = UNSET
        if not isinstance(self.credentials, Unset):
            credentials = self.credentials.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if config is not UNSET:
            field_dict["config"] = config
        if credentials is not UNSET:
            field_dict["credentials"] = credentials

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_security_lake_sources_by_id_test_body_config import (
            PostApiGovernanceSecurityLakeSourcesByIdTestBodyConfig,
        )
        from ..models.post_api_governance_security_lake_sources_by_id_test_body_credentials import (
            PostApiGovernanceSecurityLakeSourcesByIdTestBodyCredentials,
        )

        d = dict(src_dict)
        _config = d.pop("config", UNSET)
        config: PostApiGovernanceSecurityLakeSourcesByIdTestBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = PostApiGovernanceSecurityLakeSourcesByIdTestBodyConfig.from_dict(_config)

        _credentials = d.pop("credentials", UNSET)
        credentials: PostApiGovernanceSecurityLakeSourcesByIdTestBodyCredentials | Unset
        if isinstance(_credentials, Unset):
            credentials = UNSET
        else:
            credentials = PostApiGovernanceSecurityLakeSourcesByIdTestBodyCredentials.from_dict(_credentials)

        post_api_governance_security_lake_sources_by_id_test_body = cls(
            config=config,
            credentials=credentials,
        )

        return post_api_governance_security_lake_sources_by_id_test_body
