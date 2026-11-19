from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_governance_registry_ard_search_body_query_filter import (
        PostApiGovernanceRegistryArdSearchBodyQueryFilter,
    )


T = TypeVar("T", bound="PostApiGovernanceRegistryArdSearchBodyQuery")


@_attrs_define
class PostApiGovernanceRegistryArdSearchBodyQuery:
    """
    Attributes:
        text (str):
        filter_ (PostApiGovernanceRegistryArdSearchBodyQueryFilter | Unset):
    """

    text: str
    filter_: PostApiGovernanceRegistryArdSearchBodyQueryFilter | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        text = self.text

        filter_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filter_, Unset):
            filter_ = self.filter_.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "text": text,
            }
        )
        if filter_ is not UNSET:
            field_dict["filter"] = filter_

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_registry_ard_search_body_query_filter import (
            PostApiGovernanceRegistryArdSearchBodyQueryFilter,
        )

        d = dict(src_dict)
        text = d.pop("text")

        _filter_ = d.pop("filter", UNSET)
        filter_: PostApiGovernanceRegistryArdSearchBodyQueryFilter | Unset
        if isinstance(_filter_, Unset):
            filter_ = UNSET
        else:
            filter_ = PostApiGovernanceRegistryArdSearchBodyQueryFilter.from_dict(_filter_)

        post_api_governance_registry_ard_search_body_query = cls(
            text=text,
            filter_=filter_,
        )

        post_api_governance_registry_ard_search_body_query.additional_properties = d
        return post_api_governance_registry_ard_search_body_query

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
