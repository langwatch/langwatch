from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_monitors_body_mappings_type_0_mapping_additional_property_type_1_source_type_0 import (
    PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1SourceType0,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1")


@_attrs_define
class PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1:
    """
    Attributes:
        source (Literal[''] | PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1SourceType0):
        type_ (Literal['thread']):
        key (str | Unset):
        subkey (str | Unset):
        selected_fields (list[str] | Unset):
    """

    source: Literal[""] | PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1SourceType0
    type_: Literal["thread"]
    key: str | Unset = UNSET
    subkey: str | Unset = UNSET
    selected_fields: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        source: Literal[""] | str
        if isinstance(self.source, PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1SourceType0):
            source = self.source.value
        else:
            source = self.source

        type_ = self.type_

        key = self.key

        subkey = self.subkey

        selected_fields: list[str] | Unset = UNSET
        if not isinstance(self.selected_fields, Unset):
            selected_fields = self.selected_fields

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "source": source,
                "type": type_,
            }
        )
        if key is not UNSET:
            field_dict["key"] = key
        if subkey is not UNSET:
            field_dict["subkey"] = subkey
        if selected_fields is not UNSET:
            field_dict["selectedFields"] = selected_fields

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_source(
            data: object,
        ) -> Literal[""] | PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1SourceType0:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                source_type_0 = PostApiMonitorsBodyMappingsType0MappingAdditionalPropertyType1SourceType0(data)

                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            source_type_1 = cast(Literal[""], data)
            if source_type_1 != "":
                raise ValueError(f"source_type_1 must match const '', got '{source_type_1}'")
            return source_type_1

        source = _parse_source(d.pop("source"))

        type_ = cast(Literal["thread"], d.pop("type"))
        if type_ != "thread":
            raise ValueError(f"type must match const 'thread', got '{type_}'")

        key = d.pop("key", UNSET)

        subkey = d.pop("subkey", UNSET)

        selected_fields = cast(list[str], d.pop("selectedFields", UNSET))

        post_api_monitors_body_mappings_type_0_mapping_additional_property_type_1 = cls(
            source=source,
            type_=type_,
            key=key,
            subkey=subkey,
            selected_fields=selected_fields,
        )

        post_api_monitors_body_mappings_type_0_mapping_additional_property_type_1.additional_properties = d
        return post_api_monitors_body_mappings_type_0_mapping_additional_property_type_1

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
