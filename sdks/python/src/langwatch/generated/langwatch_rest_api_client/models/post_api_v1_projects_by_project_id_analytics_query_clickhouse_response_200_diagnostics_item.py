from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_diagnostics_item_code import (
    PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemCode,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_diagnostics_item_meta import (
        PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemMeta,
    )


T = TypeVar("T", bound="PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItem")


@_attrs_define
class PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItem:
    """
    Attributes:
        code (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemCode):
        message (str):
        meta (PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemMeta | Unset):
    """

    code: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemCode
    message: str
    meta: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemMeta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code = self.code.value

        message = self.message

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_diagnostics_item_meta import (
            PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemMeta,
        )

        d = dict(src_dict)
        code = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemCode(d.pop("code"))

        message = d.pop("message")

        _meta = d.pop("meta", UNSET)
        meta: PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = PostApiV1ProjectsByProjectIdAnalyticsQueryClickhouseResponse200DiagnosticsItemMeta.from_dict(_meta)

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_diagnostics_item = cls(
            code=code,
            message=message,
            meta=meta,
        )

        post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_diagnostics_item.additional_properties = d
        return post_api_v1_projects_by_project_id_analytics_query_clickhouse_response_200_diagnostics_item

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
