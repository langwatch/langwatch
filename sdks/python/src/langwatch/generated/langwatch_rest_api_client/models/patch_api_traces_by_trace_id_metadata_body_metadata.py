from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.patch_api_traces_by_trace_id_metadata_body_metadata_additional_property_type_4 import (
        PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4,
    )


T = TypeVar("T", bound="PatchApiTracesByTraceIdMetadataBodyMetadata")


@_attrs_define
class PatchApiTracesByTraceIdMetadataBodyMetadata:
    """ """

    additional_properties: dict[
        str, bool | float | list[str] | PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4 | str
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_traces_by_trace_id_metadata_body_metadata_additional_property_type_4 import (
            PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4,
        )

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, list):
                field_dict[prop_name] = prop

            elif isinstance(prop, PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_traces_by_trace_id_metadata_body_metadata_additional_property_type_4 import (
            PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4,
        )

        d = dict(src_dict)
        patch_api_traces_by_trace_id_metadata_body_metadata = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> bool | float | list[str] | PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4 | str:
                try:
                    if not isinstance(data, list):
                        raise TypeError()
                    additional_property_type_3 = cast(list[str], data)

                    return additional_property_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_4 = (
                        PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4.from_dict(data)
                    )

                    return additional_property_type_4
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                return cast(
                    bool | float | list[str] | PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4 | str,
                    data,
                )

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        patch_api_traces_by_trace_id_metadata_body_metadata.additional_properties = additional_properties
        return patch_api_traces_by_trace_id_metadata_body_metadata

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> bool | float | list[str] | PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4 | str:
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: bool | float | list[str] | PatchApiTracesByTraceIdMetadataBodyMetadataAdditionalPropertyType4 | str,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
