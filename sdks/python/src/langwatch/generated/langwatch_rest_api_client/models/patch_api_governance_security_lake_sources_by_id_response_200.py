from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.patch_api_governance_security_lake_sources_by_id_response_200_sources_item import (
    PatchApiGovernanceSecurityLakeSourcesByIdResponse200SourcesItem,
)

T = TypeVar("T", bound="PatchApiGovernanceSecurityLakeSourcesByIdResponse200")


@_attrs_define
class PatchApiGovernanceSecurityLakeSourcesByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        status (str):
        region (str):
        queue_url (str):
        subscriber_role_arn (str):
        external_id (str):
        sources (list[PatchApiGovernanceSecurityLakeSourcesByIdResponse200SourcesItem]):
        schedule (None | str):
    """

    id: str
    name: str
    status: str
    region: str
    queue_url: str
    subscriber_role_arn: str
    external_id: str
    sources: list[PatchApiGovernanceSecurityLakeSourcesByIdResponse200SourcesItem]
    schedule: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        status = self.status

        region = self.region

        queue_url = self.queue_url

        subscriber_role_arn = self.subscriber_role_arn

        external_id = self.external_id

        sources = []
        for sources_item_data in self.sources:
            sources_item = sources_item_data.value
            sources.append(sources_item)

        schedule: None | str
        schedule = self.schedule

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "status": status,
                "region": region,
                "queueUrl": queue_url,
                "subscriberRoleArn": subscriber_role_arn,
                "externalId": external_id,
                "sources": sources,
                "schedule": schedule,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        status = d.pop("status")

        region = d.pop("region")

        queue_url = d.pop("queueUrl")

        subscriber_role_arn = d.pop("subscriberRoleArn")

        external_id = d.pop("externalId")

        sources = []
        _sources = d.pop("sources")
        for sources_item_data in _sources:
            sources_item = PatchApiGovernanceSecurityLakeSourcesByIdResponse200SourcesItem(sources_item_data)

            sources.append(sources_item)

        def _parse_schedule(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        schedule = _parse_schedule(d.pop("schedule"))

        patch_api_governance_security_lake_sources_by_id_response_200 = cls(
            id=id,
            name=name,
            status=status,
            region=region,
            queue_url=queue_url,
            subscriber_role_arn=subscriber_role_arn,
            external_id=external_id,
            sources=sources,
            schedule=schedule,
        )

        return patch_api_governance_security_lake_sources_by_id_response_200
