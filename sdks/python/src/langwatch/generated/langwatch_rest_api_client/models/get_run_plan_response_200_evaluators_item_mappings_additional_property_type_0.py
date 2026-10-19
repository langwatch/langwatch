from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_run_plan_response_200_evaluators_item_mappings_additional_property_type_0_source_id import (
    GetRunPlanResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId,
)

T = TypeVar("T", bound="GetRunPlanResponse200EvaluatorsItemMappingsAdditionalPropertyType0")


@_attrs_define
class GetRunPlanResponse200EvaluatorsItemMappingsAdditionalPropertyType0:
    """
    Attributes:
        type_ (Literal['source']):
        source_id (GetRunPlanResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId):
        path (list[str]):
    """

    type_: Literal["source"]
    source_id: GetRunPlanResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId
    path: list[str]

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        source_id = self.source_id.value

        path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "sourceId": source_id,
                "path": path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = cast(Literal["source"], d.pop("type"))
        if type_ != "source":
            raise ValueError(f"type must match const 'source', got '{type_}'")

        source_id = GetRunPlanResponse200EvaluatorsItemMappingsAdditionalPropertyType0SourceId(d.pop("sourceId"))

        path = cast(list[str], d.pop("path"))

        get_run_plan_response_200_evaluators_item_mappings_additional_property_type_0 = cls(
            type_=type_,
            source_id=source_id,
            path=path,
        )

        return get_run_plan_response_200_evaluators_item_mappings_additional_property_type_0
