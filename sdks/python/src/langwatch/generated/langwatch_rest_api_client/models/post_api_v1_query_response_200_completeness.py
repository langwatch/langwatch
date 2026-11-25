from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_v1_query_response_200_completeness_state import PostApiV1QueryResponse200CompletenessState
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_query_response_200_completeness_buckets_item import (
        PostApiV1QueryResponse200CompletenessBucketsItem,
    )
    from ..models.post_api_v1_query_response_200_completeness_fields_item import (
        PostApiV1QueryResponse200CompletenessFieldsItem,
    )
    from ..models.post_api_v1_query_response_200_completeness_unpriced import (
        PostApiV1QueryResponse200CompletenessUnpriced,
    )


T = TypeVar("T", bound="PostApiV1QueryResponse200Completeness")


@_attrs_define
class PostApiV1QueryResponse200Completeness:
    """
    Attributes:
        state (PostApiV1QueryResponse200CompletenessState):
        unit (str):
        total (float):
        fields (list[PostApiV1QueryResponse200CompletenessFieldsItem]):
        buckets (list[PostApiV1QueryResponse200CompletenessBucketsItem] | Unset):
        unpriced (PostApiV1QueryResponse200CompletenessUnpriced | Unset):
    """

    state: PostApiV1QueryResponse200CompletenessState
    unit: str
    total: float
    fields: list[PostApiV1QueryResponse200CompletenessFieldsItem]
    buckets: list[PostApiV1QueryResponse200CompletenessBucketsItem] | Unset = UNSET
    unpriced: PostApiV1QueryResponse200CompletenessUnpriced | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        state = self.state.value

        unit = self.unit

        total = self.total

        fields = []
        for fields_item_data in self.fields:
            fields_item = fields_item_data.to_dict()
            fields.append(fields_item)

        buckets: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.buckets, Unset):
            buckets = []
            for buckets_item_data in self.buckets:
                buckets_item = buckets_item_data.to_dict()
                buckets.append(buckets_item)

        unpriced: dict[str, Any] | Unset = UNSET
        if not isinstance(self.unpriced, Unset):
            unpriced = self.unpriced.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "state": state,
                "unit": unit,
                "total": total,
                "fields": fields,
            }
        )
        if buckets is not UNSET:
            field_dict["buckets"] = buckets
        if unpriced is not UNSET:
            field_dict["unpriced"] = unpriced

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_query_response_200_completeness_buckets_item import (
            PostApiV1QueryResponse200CompletenessBucketsItem,
        )
        from ..models.post_api_v1_query_response_200_completeness_fields_item import (
            PostApiV1QueryResponse200CompletenessFieldsItem,
        )
        from ..models.post_api_v1_query_response_200_completeness_unpriced import (
            PostApiV1QueryResponse200CompletenessUnpriced,
        )

        d = dict(src_dict)
        state = PostApiV1QueryResponse200CompletenessState(d.pop("state"))

        unit = d.pop("unit")

        total = d.pop("total")

        fields = []
        _fields = d.pop("fields")
        for fields_item_data in _fields:
            fields_item = PostApiV1QueryResponse200CompletenessFieldsItem.from_dict(fields_item_data)

            fields.append(fields_item)

        _buckets = d.pop("buckets", UNSET)
        buckets: list[PostApiV1QueryResponse200CompletenessBucketsItem] | Unset = UNSET
        if _buckets is not UNSET:
            buckets = []
            for buckets_item_data in _buckets:
                buckets_item = PostApiV1QueryResponse200CompletenessBucketsItem.from_dict(buckets_item_data)

                buckets.append(buckets_item)

        _unpriced = d.pop("unpriced", UNSET)
        unpriced: PostApiV1QueryResponse200CompletenessUnpriced | Unset
        if isinstance(_unpriced, Unset):
            unpriced = UNSET
        else:
            unpriced = PostApiV1QueryResponse200CompletenessUnpriced.from_dict(_unpriced)

        post_api_v1_query_response_200_completeness = cls(
            state=state,
            unit=unit,
            total=total,
            fields=fields,
            buckets=buckets,
            unpriced=unpriced,
        )

        post_api_v1_query_response_200_completeness.additional_properties = d
        return post_api_v1_query_response_200_completeness

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
