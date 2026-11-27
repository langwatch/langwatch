from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGovernanceSecurityLakeSourcesByIdTestBodyCredentials")


@_attrs_define
class PostApiGovernanceSecurityLakeSourcesByIdTestBodyCredentials:
    """
    Attributes:
        aws_access_key_id (str):
        aws_secret_access_key (str):
        aws_session_token (str | Unset):
    """

    aws_access_key_id: str
    aws_secret_access_key: str
    aws_session_token: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        aws_access_key_id = self.aws_access_key_id

        aws_secret_access_key = self.aws_secret_access_key

        aws_session_token = self.aws_session_token

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "aws_access_key_id": aws_access_key_id,
                "aws_secret_access_key": aws_secret_access_key,
            }
        )
        if aws_session_token is not UNSET:
            field_dict["aws_session_token"] = aws_session_token

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        aws_access_key_id = d.pop("aws_access_key_id")

        aws_secret_access_key = d.pop("aws_secret_access_key")

        aws_session_token = d.pop("aws_session_token", UNSET)

        post_api_governance_security_lake_sources_by_id_test_body_credentials = cls(
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            aws_session_token=aws_session_token,
        )

        post_api_governance_security_lake_sources_by_id_test_body_credentials.additional_properties = d
        return post_api_governance_security_lake_sources_by_id_test_body_credentials

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
