from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_triggers_body_type_1_report_source_type_2_filters import (
        PostApiTriggersBodyType1ReportSourceType2Filters,
    )


T = TypeVar("T", bound="PostApiTriggersBodyType1ReportSourceType2")


@_attrs_define
class PostApiTriggersBodyType1ReportSourceType2:
    """
    Attributes:
        kind (Literal['traceQuery']):
        filters (PostApiTriggersBodyType1ReportSourceType2Filters | Unset):
        metric (str | Unset):
        top_n (int | Unset):  Default: 5.
    """

    kind: Literal["traceQuery"]
    filters: PostApiTriggersBodyType1ReportSourceType2Filters | Unset = UNSET
    metric: str | Unset = UNSET
    top_n: int | Unset = 5
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        metric = self.metric

        top_n = self.top_n

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "kind": kind,
            }
        )
        if filters is not UNSET:
            field_dict["filters"] = filters
        if metric is not UNSET:
            field_dict["metric"] = metric
        if top_n is not UNSET:
            field_dict["topN"] = top_n

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_triggers_body_type_1_report_source_type_2_filters import (
            PostApiTriggersBodyType1ReportSourceType2Filters,
        )

        d = dict(src_dict)
        kind = cast(Literal["traceQuery"], d.pop("kind"))
        if kind != "traceQuery":
            raise ValueError(f"kind must match const 'traceQuery', got '{kind}'")

        _filters = d.pop("filters", UNSET)
        filters: PostApiTriggersBodyType1ReportSourceType2Filters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostApiTriggersBodyType1ReportSourceType2Filters.from_dict(_filters)

        metric = d.pop("metric", UNSET)

        top_n = d.pop("topN", UNSET)

        post_api_triggers_body_type_1_report_source_type_2 = cls(
            kind=kind,
            filters=filters,
            metric=metric,
            top_n=top_n,
        )

        post_api_triggers_body_type_1_report_source_type_2.additional_properties = d
        return post_api_triggers_body_type_1_report_source_type_2

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
