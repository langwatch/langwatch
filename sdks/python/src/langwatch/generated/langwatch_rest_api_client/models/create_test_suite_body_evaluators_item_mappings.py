from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.create_test_suite_body_evaluators_item_mappings_additional_property_type_0 import (
        CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0,
    )
    from ..models.create_test_suite_body_evaluators_item_mappings_additional_property_type_1 import (
        CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType1,
    )


T = TypeVar("T", bound="CreateTestSuiteBodyEvaluatorsItemMappings")


@_attrs_define
class CreateTestSuiteBodyEvaluatorsItemMappings:
    """Where each evaluator input reads its value, keyed by input name. Inputs left out are unmapped; a required input left
    unmapped refuses the run.

    """

    additional_properties: dict[
        str,
        CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0
        | CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType1,
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.create_test_suite_body_evaluators_item_mappings_additional_property_type_0 import (
            CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0,
        )

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_test_suite_body_evaluators_item_mappings_additional_property_type_0 import (
            CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0,
        )
        from ..models.create_test_suite_body_evaluators_item_mappings_additional_property_type_1 import (
            CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType1,
        )

        d = dict(src_dict)
        create_test_suite_body_evaluators_item_mappings = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> (
                CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0
                | CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType1
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_0 = (
                        CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0.from_dict(data)
                    )

                    return additional_property_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_1 = CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType1.from_dict(
                    data
                )

                return additional_property_type_1

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        create_test_suite_body_evaluators_item_mappings.additional_properties = additional_properties
        return create_test_suite_body_evaluators_item_mappings

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> (
        CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0
        | CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType1
    ):
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType0
        | CreateTestSuiteBodyEvaluatorsItemMappingsAdditionalPropertyType1,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
