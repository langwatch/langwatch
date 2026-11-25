from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_body_action_params_type_4_annotators_item import (
        PatchApiTriggersByIdBodyActionParamsType4AnnotatorsItem,
    )


T = TypeVar("T", bound="PatchApiTriggersByIdBodyActionParamsType4")


@_attrs_define
class PatchApiTriggersByIdBodyActionParamsType4:
    """Queue matched traces for a person to label.

    Attributes:
        annotators (list[PatchApiTriggersByIdBodyActionParamsType4AnnotatorsItem]): Who the queued items go to.
    """

    annotators: list[PatchApiTriggersByIdBodyActionParamsType4AnnotatorsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        annotators = []
        for annotators_item_data in self.annotators:
            annotators_item = annotators_item_data.to_dict()
            annotators.append(annotators_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "annotators": annotators,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_triggers_by_id_body_action_params_type_4_annotators_item import (
            PatchApiTriggersByIdBodyActionParamsType4AnnotatorsItem,
        )

        d = dict(src_dict)
        annotators = []
        _annotators = d.pop("annotators")
        for annotators_item_data in _annotators:
            annotators_item = PatchApiTriggersByIdBodyActionParamsType4AnnotatorsItem.from_dict(annotators_item_data)

            annotators.append(annotators_item)

        patch_api_triggers_by_id_body_action_params_type_4 = cls(
            annotators=annotators,
        )

        patch_api_triggers_by_id_body_action_params_type_4.additional_properties = d
        return patch_api_triggers_by_id_body_action_params_type_4

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
