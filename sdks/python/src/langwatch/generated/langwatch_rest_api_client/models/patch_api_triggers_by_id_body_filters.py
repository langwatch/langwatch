from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_body_filters_additional_property_type_1 import (
        PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1,
    )
    from ..models.patch_api_triggers_by_id_body_filters_additional_property_type_2 import (
        PatchApiTriggersByIdBodyFiltersAdditionalPropertyType2,
    )


T = TypeVar("T", bound="PatchApiTriggersByIdBodyFilters")


@_attrs_define
class PatchApiTriggersByIdBodyFilters:
    """ """

    additional_properties: dict[
        str,
        list[str]
        | PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1
        | PatchApiTriggersByIdBodyFiltersAdditionalPropertyType2,
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_triggers_by_id_body_filters_additional_property_type_1 import (
            PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1,
        )

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, list):
                field_dict[prop_name] = prop

            elif isinstance(prop, PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_triggers_by_id_body_filters_additional_property_type_1 import (
            PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1,
        )
        from ..models.patch_api_triggers_by_id_body_filters_additional_property_type_2 import (
            PatchApiTriggersByIdBodyFiltersAdditionalPropertyType2,
        )

        d = dict(src_dict)
        patch_api_triggers_by_id_body_filters = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> (
                list[str]
                | PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1
                | PatchApiTriggersByIdBodyFiltersAdditionalPropertyType2
            ):
                try:
                    if not isinstance(data, list):
                        raise TypeError()
                    additional_property_type_0 = cast(list[str], data)

                    return additional_property_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_1 = PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1.from_dict(data)

                    return additional_property_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_2 = PatchApiTriggersByIdBodyFiltersAdditionalPropertyType2.from_dict(data)

                return additional_property_type_2

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        patch_api_triggers_by_id_body_filters.additional_properties = additional_properties
        return patch_api_triggers_by_id_body_filters

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> (
        list[str]
        | PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1
        | PatchApiTriggersByIdBodyFiltersAdditionalPropertyType2
    ):
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: list[str]
        | PatchApiTriggersByIdBodyFiltersAdditionalPropertyType1
        | PatchApiTriggersByIdBodyFiltersAdditionalPropertyType2,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
