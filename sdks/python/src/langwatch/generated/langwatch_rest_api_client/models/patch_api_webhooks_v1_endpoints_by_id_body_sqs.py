from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiWebhooksV1EndpointsByIdBodySqs")


@_attrs_define
class PatchApiWebhooksV1EndpointsByIdBodySqs:
    """
    Attributes:
        queue_url (str | Unset):
        role_arn (str | Unset):
        external_id (str | Unset):
        access_key_id (str | Unset):
        secret_access_key (str | Unset):
    """

    queue_url: str | Unset = UNSET
    role_arn: str | Unset = UNSET
    external_id: str | Unset = UNSET
    access_key_id: str | Unset = UNSET
    secret_access_key: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        queue_url = self.queue_url

        role_arn = self.role_arn

        external_id = self.external_id

        access_key_id = self.access_key_id

        secret_access_key = self.secret_access_key

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if queue_url is not UNSET:
            field_dict["queue_url"] = queue_url
        if role_arn is not UNSET:
            field_dict["role_arn"] = role_arn
        if external_id is not UNSET:
            field_dict["external_id"] = external_id
        if access_key_id is not UNSET:
            field_dict["access_key_id"] = access_key_id
        if secret_access_key is not UNSET:
            field_dict["secret_access_key"] = secret_access_key

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        queue_url = d.pop("queue_url", UNSET)

        role_arn = d.pop("role_arn", UNSET)

        external_id = d.pop("external_id", UNSET)

        access_key_id = d.pop("access_key_id", UNSET)

        secret_access_key = d.pop("secret_access_key", UNSET)

        patch_api_webhooks_v1_endpoints_by_id_body_sqs = cls(
            queue_url=queue_url,
            role_arn=role_arn,
            external_id=external_id,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
        )

        patch_api_webhooks_v1_endpoints_by_id_body_sqs.additional_properties = d
        return patch_api_webhooks_v1_endpoints_by_id_body_sqs

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
