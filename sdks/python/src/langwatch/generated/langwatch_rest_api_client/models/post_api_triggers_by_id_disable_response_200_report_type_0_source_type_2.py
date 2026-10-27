from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_2_filters import (
        PostApiTriggersByIdDisableResponse200ReportType0SourceType2Filters,
    )


T = TypeVar("T", bound="PostApiTriggersByIdDisableResponse200ReportType0SourceType2")


@_attrs_define
class PostApiTriggersByIdDisableResponse200ReportType0SourceType2:
    """
    Attributes:
        kind (Literal['traceQuery']):
        filters (PostApiTriggersByIdDisableResponse200ReportType0SourceType2Filters):
        top_n (int):  Default: 5.
        metric (str | Unset):
    """

    kind: Literal["traceQuery"]
    filters: PostApiTriggersByIdDisableResponse200ReportType0SourceType2Filters
    top_n: int = 5
    metric: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        filters = self.filters.to_dict()

        top_n = self.top_n

        metric = self.metric

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "filters": filters,
                "topN": top_n,
            }
        )
        if metric is not UNSET:
            field_dict["metric"] = metric

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_triggers_by_id_disable_response_200_report_type_0_source_type_2_filters import (
            PostApiTriggersByIdDisableResponse200ReportType0SourceType2Filters,
        )

        d = dict(src_dict)
        kind = cast(Literal["traceQuery"], d.pop("kind"))
        if kind != "traceQuery":
            raise ValueError(f"kind must match const 'traceQuery', got '{kind}'")

        filters = PostApiTriggersByIdDisableResponse200ReportType0SourceType2Filters.from_dict(d.pop("filters"))

        top_n = d.pop("topN")

        metric = d.pop("metric", UNSET)

        post_api_triggers_by_id_disable_response_200_report_type_0_source_type_2 = cls(
            kind=kind,
            filters=filters,
            top_n=top_n,
            metric=metric,
        )

        return post_api_triggers_by_id_disable_response_200_report_type_0_source_type_2
