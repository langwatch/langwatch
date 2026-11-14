from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_registry_ard_search_response_200_results_item import (
        PostApiGovernanceRegistryArdSearchResponse200ResultsItem,
    )


T = TypeVar("T", bound="PostApiGovernanceRegistryArdSearchResponse200")


@_attrs_define
class PostApiGovernanceRegistryArdSearchResponse200:
    """
    Attributes:
        results (list[PostApiGovernanceRegistryArdSearchResponse200ResultsItem]):
        page_token (str | Unset):
    """

    results: list[PostApiGovernanceRegistryArdSearchResponse200ResultsItem]
    page_token: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        results = []
        for results_item_data in self.results:
            results_item = results_item_data.to_dict()
            results.append(results_item)

        page_token = self.page_token

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "results": results,
            }
        )
        if page_token is not UNSET:
            field_dict["pageToken"] = page_token

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_registry_ard_search_response_200_results_item import (
            PostApiGovernanceRegistryArdSearchResponse200ResultsItem,
        )

        d = dict(src_dict)
        results = []
        _results = d.pop("results")
        for results_item_data in _results:
            results_item = PostApiGovernanceRegistryArdSearchResponse200ResultsItem.from_dict(results_item_data)

            results.append(results_item)

        page_token = d.pop("pageToken", UNSET)

        post_api_governance_registry_ard_search_response_200 = cls(
            results=results,
            page_token=page_token,
        )

        return post_api_governance_registry_ard_search_response_200
