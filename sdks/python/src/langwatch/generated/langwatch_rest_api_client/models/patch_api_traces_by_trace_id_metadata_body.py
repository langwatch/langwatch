from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.patch_api_traces_by_trace_id_metadata_body_metadata import PatchApiTracesByTraceIdMetadataBodyMetadata


T = TypeVar("T", bound="PatchApiTracesByTraceIdMetadataBody")


@_attrs_define
class PatchApiTracesByTraceIdMetadataBody:
    """
    Attributes:
        metadata (PatchApiTracesByTraceIdMetadataBodyMetadata):
    """

    metadata: PatchApiTracesByTraceIdMetadataBodyMetadata
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "metadata": metadata,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_traces_by_trace_id_metadata_body_metadata import (
            PatchApiTracesByTraceIdMetadataBodyMetadata,
        )

        d = dict(src_dict)
        metadata = PatchApiTracesByTraceIdMetadataBodyMetadata.from_dict(d.pop("metadata"))

        patch_api_traces_by_trace_id_metadata_body = cls(
            metadata=metadata,
        )

        patch_api_traces_by_trace_id_metadata_body.additional_properties = d
        return patch_api_traces_by_trace_id_metadata_body

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
