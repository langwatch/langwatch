from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_body_action_params_type_3_dataset_mapping_mapping import (
        PatchApiTriggersByIdBodyActionParamsType3DatasetMappingMapping,
    )


T = TypeVar("T", bound="PatchApiTriggersByIdBodyActionParamsType3DatasetMapping")


@_attrs_define
class PatchApiTriggersByIdBodyActionParamsType3DatasetMapping:
    """How a trace becomes a row in that dataset.

    Attributes:
        mapping (PatchApiTriggersByIdBodyActionParamsType3DatasetMappingMapping):
        expansions (list[str] | Unset):
    """

    mapping: PatchApiTriggersByIdBodyActionParamsType3DatasetMappingMapping
    expansions: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        mapping = self.mapping.to_dict()

        expansions: list[str] | Unset = UNSET
        if not isinstance(self.expansions, Unset):
            expansions = self.expansions

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "mapping": mapping,
            }
        )
        if expansions is not UNSET:
            field_dict["expansions"] = expansions

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_triggers_by_id_body_action_params_type_3_dataset_mapping_mapping import (
            PatchApiTriggersByIdBodyActionParamsType3DatasetMappingMapping,
        )

        d = dict(src_dict)
        mapping = PatchApiTriggersByIdBodyActionParamsType3DatasetMappingMapping.from_dict(d.pop("mapping"))

        expansions = cast(list[str], d.pop("expansions", UNSET))

        patch_api_triggers_by_id_body_action_params_type_3_dataset_mapping = cls(
            mapping=mapping,
            expansions=expansions,
        )

        patch_api_triggers_by_id_body_action_params_type_3_dataset_mapping.additional_properties = d
        return patch_api_triggers_by_id_body_action_params_type_3_dataset_mapping

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
