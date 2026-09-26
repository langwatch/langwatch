from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1")


@_attrs_define
class GetRunPlanResponse200TargetsItemScenarioMappingsAdditionalPropertyType1:
    """
    Attributes:
        type_ (Literal['value']):
        value (str):
    """

    type_: Literal["value"]
    value: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["value"], d.pop("type"))
        if type_ != "value":
            raise ValueError(f"type must match const 'value', got '{type_}'")

        value = d.pop("value")

        get_run_plan_response_200_targets_item_scenario_mappings_additional_property_type_1 = cls(
            type_=type_,
            value=value,
        )

        return get_run_plan_response_200_targets_item_scenario_mappings_additional_property_type_1
