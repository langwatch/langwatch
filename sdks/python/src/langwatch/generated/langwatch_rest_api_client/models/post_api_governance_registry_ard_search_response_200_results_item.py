from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_registry_ard_search_response_200_results_item_data import (
        PostApiGovernanceRegistryArdSearchResponse200ResultsItemData,
    )
    from ..models.post_api_governance_registry_ard_search_response_200_results_item_metadata import (
        PostApiGovernanceRegistryArdSearchResponse200ResultsItemMetadata,
    )


T = TypeVar("T", bound="PostApiGovernanceRegistryArdSearchResponse200ResultsItem")


@_attrs_define
class PostApiGovernanceRegistryArdSearchResponse200ResultsItem:
    """
    Attributes:
        context (Literal['https://agenticresourcediscovery.org/context/v1']):
        identifier (str):
        display_name (str):
        type_ (Literal['application/agent-card+json']):
        version (str):
        updated_at (str):
        tags (list[str]):
        capabilities (list[str]):
        data (PostApiGovernanceRegistryArdSearchResponse200ResultsItemData):
        metadata (PostApiGovernanceRegistryArdSearchResponse200ResultsItemMetadata):
        score (float):
        source (str):
        description (str | Unset):
    """

    context: Literal["https://agenticresourcediscovery.org/context/v1"]
    identifier: str
    display_name: str
    type_: Literal["application/agent-card+json"]
    version: str
    updated_at: str
    tags: list[str]
    capabilities: list[str]
    data: PostApiGovernanceRegistryArdSearchResponse200ResultsItemData
    metadata: PostApiGovernanceRegistryArdSearchResponse200ResultsItemMetadata
    score: float
    source: str
    description: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        context = self.context

        identifier = self.identifier

        display_name = self.display_name

        type_ = self.type_

        version = self.version

        updated_at = self.updated_at

        tags = self.tags

        capabilities = self.capabilities

        data = self.data.to_dict()

        metadata = self.metadata.to_dict()

        score = self.score

        source = self.source

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "@context": context,
                "identifier": identifier,
                "displayName": display_name,
                "type": type_,
                "version": version,
                "updatedAt": updated_at,
                "tags": tags,
                "capabilities": capabilities,
                "data": data,
                "metadata": metadata,
                "score": score,
                "source": source,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_registry_ard_search_response_200_results_item_data import (
            PostApiGovernanceRegistryArdSearchResponse200ResultsItemData,
        )
        from ..models.post_api_governance_registry_ard_search_response_200_results_item_metadata import (
            PostApiGovernanceRegistryArdSearchResponse200ResultsItemMetadata,
        )

        d = dict(src_dict)
        context = cast(Literal["https://agenticresourcediscovery.org/context/v1"], d.pop("@context"))
        if context != "https://agenticresourcediscovery.org/context/v1":
            raise ValueError(
                f"@context must match const 'https://agenticresourcediscovery.org/context/v1', got '{context}'"
            )

        identifier = d.pop("identifier")

        display_name = d.pop("displayName")

        type_ = cast(Literal["application/agent-card+json"], d.pop("type"))
        if type_ != "application/agent-card+json":
            raise ValueError(f"type must match const 'application/agent-card+json', got '{type_}'")

        version = d.pop("version")

        updated_at = d.pop("updatedAt")

        tags = cast(list[str], d.pop("tags"))

        capabilities = cast(list[str], d.pop("capabilities"))

        data = PostApiGovernanceRegistryArdSearchResponse200ResultsItemData.from_dict(d.pop("data"))

        metadata = PostApiGovernanceRegistryArdSearchResponse200ResultsItemMetadata.from_dict(d.pop("metadata"))

        score = d.pop("score")

        source = d.pop("source")

        description = d.pop("description", UNSET)

        post_api_governance_registry_ard_search_response_200_results_item = cls(
            context=context,
            identifier=identifier,
            display_name=display_name,
            type_=type_,
            version=version,
            updated_at=updated_at,
            tags=tags,
            capabilities=capabilities,
            data=data,
            metadata=metadata,
            score=score,
            source=source,
            description=description,
        )

        return post_api_governance_registry_ard_search_response_200_results_item
