from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings_additional_property_type_0 import (
        PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0,
    )
    from ..models.post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings_additional_property_type_1 import (
        PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType1,
    )


T = TypeVar("T", bound="PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappings")


@_attrs_define
class PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappings:
    """ """

    additional_properties: dict[
        str,
        PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0
        | PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType1,
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings_additional_property_type_0 import (
            PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0,
        )

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings_additional_property_type_0 import (
            PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0,
        )
        from ..models.post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings_additional_property_type_1 import (
            PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType1,
        )

        d = dict(src_dict)
        post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> (
                PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0
                | PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType1
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_0 = (
                        PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0.from_dict(
                            data
                        )
                    )

                    return additional_property_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_1 = (
                    PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType1.from_dict(
                        data
                    )
                )

                return additional_property_type_1

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings.additional_properties = (
            additional_properties
        )
        return post_api_suites_by_id_run_response_200_items_item_target_scenario_mappings

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> (
        PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0
        | PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType1
    ):
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType0
        | PostApiSuitesByIdRunResponse200ItemsItemTargetScenarioMappingsAdditionalPropertyType1,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
