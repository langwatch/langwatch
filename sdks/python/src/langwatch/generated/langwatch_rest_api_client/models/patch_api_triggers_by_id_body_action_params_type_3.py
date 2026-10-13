from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_body_action_params_type_3_dataset_mapping import (
        PatchApiTriggersByIdBodyActionParamsType3DatasetMapping,
    )


T = TypeVar("T", bound="PatchApiTriggersByIdBodyActionParamsType3")


@_attrs_define
class PatchApiTriggersByIdBodyActionParamsType3:
    """Append matched traces to a dataset.

    Attributes:
        dataset_id (str): The dataset matched traces are appended to.
        dataset_mapping (PatchApiTriggersByIdBodyActionParamsType3DatasetMapping): How a trace becomes a row in that
            dataset.
    """

    dataset_id: str
    dataset_mapping: PatchApiTriggersByIdBodyActionParamsType3DatasetMapping
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        dataset_id = self.dataset_id

        dataset_mapping = self.dataset_mapping.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "datasetId": dataset_id,
                "datasetMapping": dataset_mapping,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_triggers_by_id_body_action_params_type_3_dataset_mapping import (
            PatchApiTriggersByIdBodyActionParamsType3DatasetMapping,
        )

        d = dict(src_dict)
        dataset_id = d.pop("datasetId")

        dataset_mapping = PatchApiTriggersByIdBodyActionParamsType3DatasetMapping.from_dict(d.pop("datasetMapping"))

        patch_api_triggers_by_id_body_action_params_type_3 = cls(
            dataset_id=dataset_id,
            dataset_mapping=dataset_mapping,
        )

        patch_api_triggers_by_id_body_action_params_type_3.additional_properties = d
        return patch_api_triggers_by_id_body_action_params_type_3

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
