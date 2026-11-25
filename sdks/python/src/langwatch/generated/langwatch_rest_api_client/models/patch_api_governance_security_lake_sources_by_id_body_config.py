from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_governance_security_lake_sources_by_id_body_config_sources_item import (
    PatchApiGovernanceSecurityLakeSourcesByIdBodyConfigSourcesItem,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchApiGovernanceSecurityLakeSourcesByIdBodyConfig")


@_attrs_define
class PatchApiGovernanceSecurityLakeSourcesByIdBodyConfig:
    """
    Attributes:
        region (str | Unset):
        subscriber_role_arn (str | Unset):
        queue_url (str | Unset):
        sources (list[PatchApiGovernanceSecurityLakeSourcesByIdBodyConfigSourcesItem] | Unset):
        max_messages_per_run (int | Unset):
        max_receives (int | Unset):
        s_3_endpoint (None | str | Unset):
        sqs_endpoint (None | str | Unset):
        schedule (str | Unset):
    """

    region: str | Unset = UNSET
    subscriber_role_arn: str | Unset = UNSET
    queue_url: str | Unset = UNSET
    sources: list[PatchApiGovernanceSecurityLakeSourcesByIdBodyConfigSourcesItem] | Unset = UNSET
    max_messages_per_run: int | Unset = UNSET
    max_receives: int | Unset = UNSET
    s_3_endpoint: None | str | Unset = UNSET
    sqs_endpoint: None | str | Unset = UNSET
    schedule: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        region = self.region

        subscriber_role_arn = self.subscriber_role_arn

        queue_url = self.queue_url

        sources: list[str] | Unset = UNSET
        if not isinstance(self.sources, Unset):
            sources = []
            for sources_item_data in self.sources:
                sources_item = sources_item_data.value
                sources.append(sources_item)

        max_messages_per_run = self.max_messages_per_run

        max_receives = self.max_receives

        s_3_endpoint: None | str | Unset
        if isinstance(self.s_3_endpoint, Unset):
            s_3_endpoint = UNSET
        else:
            s_3_endpoint = self.s_3_endpoint

        sqs_endpoint: None | str | Unset
        if isinstance(self.sqs_endpoint, Unset):
            sqs_endpoint = UNSET
        else:
            sqs_endpoint = self.sqs_endpoint

        schedule = self.schedule

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if region is not UNSET:
            field_dict["region"] = region
        if subscriber_role_arn is not UNSET:
            field_dict["subscriberRoleArn"] = subscriber_role_arn
        if queue_url is not UNSET:
            field_dict["queueUrl"] = queue_url
        if sources is not UNSET:
            field_dict["sources"] = sources
        if max_messages_per_run is not UNSET:
            field_dict["maxMessagesPerRun"] = max_messages_per_run
        if max_receives is not UNSET:
            field_dict["maxReceives"] = max_receives
        if s_3_endpoint is not UNSET:
            field_dict["s3Endpoint"] = s_3_endpoint
        if sqs_endpoint is not UNSET:
            field_dict["sqsEndpoint"] = sqs_endpoint
        if schedule is not UNSET:
            field_dict["schedule"] = schedule

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        region = d.pop("region", UNSET)

        subscriber_role_arn = d.pop("subscriberRoleArn", UNSET)

        queue_url = d.pop("queueUrl", UNSET)

        _sources = d.pop("sources", UNSET)
        sources: list[PatchApiGovernanceSecurityLakeSourcesByIdBodyConfigSourcesItem] | Unset = UNSET
        if _sources is not UNSET:
            sources = []
            for sources_item_data in _sources:
                sources_item = PatchApiGovernanceSecurityLakeSourcesByIdBodyConfigSourcesItem(sources_item_data)

                sources.append(sources_item)

        max_messages_per_run = d.pop("maxMessagesPerRun", UNSET)

        max_receives = d.pop("maxReceives", UNSET)

        def _parse_s_3_endpoint(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        s_3_endpoint = _parse_s_3_endpoint(d.pop("s3Endpoint", UNSET))

        def _parse_sqs_endpoint(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sqs_endpoint = _parse_sqs_endpoint(d.pop("sqsEndpoint", UNSET))

        schedule = d.pop("schedule", UNSET)

        patch_api_governance_security_lake_sources_by_id_body_config = cls(
            region=region,
            subscriber_role_arn=subscriber_role_arn,
            queue_url=queue_url,
            sources=sources,
            max_messages_per_run=max_messages_per_run,
            max_receives=max_receives,
            s_3_endpoint=s_3_endpoint,
            sqs_endpoint=sqs_endpoint,
            schedule=schedule,
        )

        patch_api_governance_security_lake_sources_by_id_body_config.additional_properties = d
        return patch_api_governance_security_lake_sources_by_id_body_config

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
