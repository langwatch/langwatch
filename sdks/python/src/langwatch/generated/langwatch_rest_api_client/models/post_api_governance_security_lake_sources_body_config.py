from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_governance_security_lake_sources_body_config_sources_item import (
    PostApiGovernanceSecurityLakeSourcesBodyConfigSourcesItem,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiGovernanceSecurityLakeSourcesBodyConfig")


@_attrs_define
class PostApiGovernanceSecurityLakeSourcesBodyConfig:
    """
    Attributes:
        region (str):
        subscriber_role_arn (str):
        queue_url (str):
        sources (list[PostApiGovernanceSecurityLakeSourcesBodyConfigSourcesItem] | Unset):
        max_messages_per_run (int | Unset):  Default: 100.
        max_receives (int | Unset):  Default: 3.
        s_3_endpoint (str | Unset):
        sqs_endpoint (str | Unset):
        schedule (str | Unset):  Default: '*/5 * * * *'.
    """

    region: str
    subscriber_role_arn: str
    queue_url: str
    sources: list[PostApiGovernanceSecurityLakeSourcesBodyConfigSourcesItem] | Unset = UNSET
    max_messages_per_run: int | Unset = 100
    max_receives: int | Unset = 3
    s_3_endpoint: str | Unset = UNSET
    sqs_endpoint: str | Unset = UNSET
    schedule: str | Unset = "*/5 * * * *"
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

        s_3_endpoint = self.s_3_endpoint

        sqs_endpoint = self.sqs_endpoint

        schedule = self.schedule

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "region": region,
                "subscriberRoleArn": subscriber_role_arn,
                "queueUrl": queue_url,
            }
        )
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
        region = d.pop("region")

        subscriber_role_arn = d.pop("subscriberRoleArn")

        queue_url = d.pop("queueUrl")

        _sources = d.pop("sources", UNSET)
        sources: list[PostApiGovernanceSecurityLakeSourcesBodyConfigSourcesItem] | Unset = UNSET
        if _sources is not UNSET:
            sources = []
            for sources_item_data in _sources:
                sources_item = PostApiGovernanceSecurityLakeSourcesBodyConfigSourcesItem(sources_item_data)

                sources.append(sources_item)

        max_messages_per_run = d.pop("maxMessagesPerRun", UNSET)

        max_receives = d.pop("maxReceives", UNSET)

        s_3_endpoint = d.pop("s3Endpoint", UNSET)

        sqs_endpoint = d.pop("sqsEndpoint", UNSET)

        schedule = d.pop("schedule", UNSET)

        post_api_governance_security_lake_sources_body_config = cls(
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

        post_api_governance_security_lake_sources_body_config.additional_properties = d
        return post_api_governance_security_lake_sources_body_config

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
