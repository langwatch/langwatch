from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_response_200_report_type_0_source_type_2_filters import (
        PatchApiTriggersByIdResponse200ReportType0SourceType2Filters,
    )


T = TypeVar("T", bound="PatchApiTriggersByIdResponse200ReportType0SourceType2")


@_attrs_define
class PatchApiTriggersByIdResponse200ReportType0SourceType2:
    """
    Attributes:
        kind (Literal['traceQuery']):
        filters (PatchApiTriggersByIdResponse200ReportType0SourceType2Filters):
        top_n (int):  Default: 5.
        metric (str | Unset):
    """

    kind: Literal["traceQuery"]
    filters: PatchApiTriggersByIdResponse200ReportType0SourceType2Filters
    top_n: int = 5
    metric: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind

        filters = self.filters.to_dict()

        top_n = self.top_n

        metric = self.metric

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.patch_api_triggers_by_id_response_200_report_type_0_source_type_2_filters import (
            PatchApiTriggersByIdResponse200ReportType0SourceType2Filters,
        )

        d = dict(src_dict)
        kind = cast(Literal["traceQuery"], d.pop("kind"))
        if kind != "traceQuery":
            raise ValueError(f"kind must match const 'traceQuery', got '{kind}'")

        filters = PatchApiTriggersByIdResponse200ReportType0SourceType2Filters.from_dict(d.pop("filters"))

        top_n = d.pop("topN")

        metric = d.pop("metric", UNSET)

        patch_api_triggers_by_id_response_200_report_type_0_source_type_2 = cls(
            kind=kind,
            filters=filters,
            top_n=top_n,
            metric=metric,
        )

        patch_api_triggers_by_id_response_200_report_type_0_source_type_2.additional_properties = d
        return patch_api_triggers_by_id_response_200_report_type_0_source_type_2

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
