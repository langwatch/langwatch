from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_run_plan_response_200_targets_item_scenario_mappings_additional_property_type_0 import (
        GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0,
    )
    from ..models.get_run_plan_response_200_targets_item_scenario_mappings_additional_property_type_1 import (
        GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1,
    )


T = TypeVar("T", bound="GetRunPlanResponse200TargetsItemScenarioMappings")


@_attrs_define
class GetRunPlanResponse200TargetsItemScenarioMappings:
    """ """

    additional_properties: dict[
        str,
        GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0
        | GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1,
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_run_plan_response_200_targets_item_scenario_mappings_additional_property_type_0 import (
            GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0,
        )

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_run_plan_response_200_targets_item_scenario_mappings_additional_property_type_0 import (
            GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0,
        )
        from ..models.get_run_plan_response_200_targets_item_scenario_mappings_additional_property_type_1 import (
            GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1,
        )

        d = dict(src_dict)
        get_run_plan_response_200_targets_item_scenario_mappings = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> (
                GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0
                | GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_0 = (
                        GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0.from_dict(data)
                    )

                    return additional_property_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_1 = (
                    GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1.from_dict(data)
                )

                return additional_property_type_1

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        get_run_plan_response_200_targets_item_scenario_mappings.additional_properties = additional_properties
        return get_run_plan_response_200_targets_item_scenario_mappings

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> (
        GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0
        | GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1
    ):
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType0
        | GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
