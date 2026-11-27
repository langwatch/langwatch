from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_governance_registry_ard_search_body_federation import (
    PostApiGovernanceRegistryArdSearchBodyFederation,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_registry_ard_search_body_query import PostApiGovernanceRegistryArdSearchBodyQuery


T = TypeVar("T", bound="PostApiGovernanceRegistryArdSearchBody")


@_attrs_define
class PostApiGovernanceRegistryArdSearchBody:
    """
    Attributes:
        query (PostApiGovernanceRegistryArdSearchBodyQuery):
        federation (PostApiGovernanceRegistryArdSearchBodyFederation | Unset):
        page_size (int | Unset):  Default: 10.
        page_token (str | Unset):
    """

    query: PostApiGovernanceRegistryArdSearchBodyQuery
    federation: PostApiGovernanceRegistryArdSearchBodyFederation | Unset = UNSET
    page_size: int | Unset = 10
    page_token: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        query = self.query.to_dict()

        federation: str | Unset = UNSET
        if not isinstance(self.federation, Unset):
            federation = self.federation.value

        page_size = self.page_size

        page_token = self.page_token

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "query": query,
            }
        )
        if federation is not UNSET:
            field_dict["federation"] = federation
        if page_size is not UNSET:
            field_dict["pageSize"] = page_size
        if page_token is not UNSET:
            field_dict["pageToken"] = page_token

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_registry_ard_search_body_query import (
            PostApiGovernanceRegistryArdSearchBodyQuery,
        )

        d = dict(src_dict)
        query = PostApiGovernanceRegistryArdSearchBodyQuery.from_dict(d.pop("query"))

        _federation = d.pop("federation", UNSET)
        federation: PostApiGovernanceRegistryArdSearchBodyFederation | Unset
        if isinstance(_federation, Unset):
            federation = UNSET
        else:
            federation = PostApiGovernanceRegistryArdSearchBodyFederation(_federation)

        page_size = d.pop("pageSize", UNSET)

        page_token = d.pop("pageToken", UNSET)

        post_api_governance_registry_ard_search_body = cls(
            query=query,
            federation=federation,
            page_size=page_size,
            page_token=page_token,
        )

        post_api_governance_registry_ard_search_body.additional_properties = d
        return post_api_governance_registry_ard_search_body

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
