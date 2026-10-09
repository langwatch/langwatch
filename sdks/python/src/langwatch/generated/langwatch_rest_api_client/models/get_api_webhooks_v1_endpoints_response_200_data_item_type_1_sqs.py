from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_webhooks_v1_endpoints_response_200_data_item_type_1_sqs_credential_mode import (
    GetApiWebhooksV1EndpointsResponse200DataItemType1SqsCredentialMode,
)

T = TypeVar("T", bound="GetApiWebhooksV1EndpointsResponse200DataItemType1Sqs")


@_attrs_define
class GetApiWebhooksV1EndpointsResponse200DataItemType1Sqs:
    """
    Attributes:
        queue_url (str):
        region (str):
        account_id (str):
        queue_name (str):
        credential_mode (GetApiWebhooksV1EndpointsResponse200DataItemType1SqsCredentialMode):
        role_arn (None | str):
        external_id (None | str):
        access_key_id (None | str):
    """

    queue_url: str
    region: str
    account_id: str
    queue_name: str
    credential_mode: GetApiWebhooksV1EndpointsResponse200DataItemType1SqsCredentialMode
    role_arn: None | str
    external_id: None | str
    access_key_id: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        queue_url = self.queue_url

        region = self.region

        account_id = self.account_id

        queue_name = self.queue_name

        credential_mode = self.credential_mode.value

        role_arn: None | str
        role_arn = self.role_arn

        external_id: None | str
        external_id = self.external_id

        access_key_id: None | str
        access_key_id = self.access_key_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "queue_url": queue_url,
                "region": region,
                "account_id": account_id,
                "queue_name": queue_name,
                "credential_mode": credential_mode,
                "role_arn": role_arn,
                "external_id": external_id,
                "access_key_id": access_key_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        queue_url = d.pop("queue_url")

        region = d.pop("region")

        account_id = d.pop("account_id")

        queue_name = d.pop("queue_name")

        credential_mode = GetApiWebhooksV1EndpointsResponse200DataItemType1SqsCredentialMode(d.pop("credential_mode"))

        def _parse_role_arn(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        role_arn = _parse_role_arn(d.pop("role_arn"))

        def _parse_external_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        external_id = _parse_external_id(d.pop("external_id"))

        def _parse_access_key_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        access_key_id = _parse_access_key_id(d.pop("access_key_id"))

        get_api_webhooks_v1_endpoints_response_200_data_item_type_1_sqs = cls(
            queue_url=queue_url,
            region=region,
            account_id=account_id,
            queue_name=queue_name,
            credential_mode=credential_mode,
            role_arn=role_arn,
            external_id=external_id,
            access_key_id=access_key_id,
        )

        get_api_webhooks_v1_endpoints_response_200_data_item_type_1_sqs.additional_properties = d
        return get_api_webhooks_v1_endpoints_response_200_data_item_type_1_sqs

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
