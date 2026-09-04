from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.list_test_suites_response_200_item_evaluators_item_mappings_additional_property_type_0 import (
        ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0,
    )
    from ..models.list_test_suites_response_200_item_evaluators_item_mappings_additional_property_type_1 import (
        ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType1,
    )


T = TypeVar("T", bound="ListTestSuitesResponse200ItemEvaluatorsItemMappings")


@_attrs_define
class ListTestSuitesResponse200ItemEvaluatorsItemMappings:
    """Where each evaluator input reads its value, keyed by input name. Inputs left out are unmapped; a required input left
    unmapped refuses the run.

    """

    additional_properties: dict[
        str,
        ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0
        | ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType1,
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.list_test_suites_response_200_item_evaluators_item_mappings_additional_property_type_0 import (
            ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0,
        )

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.list_test_suites_response_200_item_evaluators_item_mappings_additional_property_type_0 import (
            ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0,
        )
        from ..models.list_test_suites_response_200_item_evaluators_item_mappings_additional_property_type_1 import (
            ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType1,
        )

        d = dict(src_dict)
        list_test_suites_response_200_item_evaluators_item_mappings = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> (
                ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0
                | ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType1
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_0 = (
                        ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0.from_dict(data)
                    )

                    return additional_property_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_1 = (
                    ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType1.from_dict(data)
                )

                return additional_property_type_1

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        list_test_suites_response_200_item_evaluators_item_mappings.additional_properties = additional_properties
        return list_test_suites_response_200_item_evaluators_item_mappings

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> (
        ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0
        | ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType1
    ):
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType0
        | ListTestSuitesResponse200ItemEvaluatorsItemMappingsAdditionalPropertyType1,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
