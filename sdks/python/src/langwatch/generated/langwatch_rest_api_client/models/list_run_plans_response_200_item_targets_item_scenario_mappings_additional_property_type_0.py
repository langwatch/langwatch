from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ListRunPlansResponse200ItemTargetsItemScenarioMappingsAdditionalPropertyType0")


@_attrs_define
class ListRunPlansResponse200ItemTargetsItemScenarioMappingsAdditionalPropertyType0:
    """
    Attributes:
        type_ (Literal['source']):
        source_id (str):
        path (list[str]):
    """

    type_: Literal["source"]
    source_id: str
    path: list[str]

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        source_id = self.source_id

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

        source_id = d.pop("sourceId")

        path = cast(list[str], d.pop("path"))

        list_run_plans_response_200_item_targets_item_scenario_mappings_additional_property_type_0 = cls(
            type_=type_,
            source_id=source_id,
            path=path,
        )

        return list_run_plans_response_200_item_targets_item_scenario_mappings_additional_property_type_0
