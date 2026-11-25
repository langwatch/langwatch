from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_triggers_body_type_4_action_params_annotators_item import (
        PostApiTriggersBodyType4ActionParamsAnnotatorsItem,
    )


T = TypeVar("T", bound="PostApiTriggersBodyType4ActionParams")


@_attrs_define
class PostApiTriggersBodyType4ActionParams:
    """Queue matched traces for a person to label.

    Attributes:
        annotators (list[PostApiTriggersBodyType4ActionParamsAnnotatorsItem]): Who the queued items go to.
    """

    annotators: list[PostApiTriggersBodyType4ActionParamsAnnotatorsItem]
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
        from ..models.post_api_triggers_body_type_4_action_params_annotators_item import (
            PostApiTriggersBodyType4ActionParamsAnnotatorsItem,
        )

        d = dict(src_dict)
        annotators = []
        _annotators = d.pop("annotators")
        for annotators_item_data in _annotators:
            annotators_item = PostApiTriggersBodyType4ActionParamsAnnotatorsItem.from_dict(annotators_item_data)

            annotators.append(annotators_item)

        post_api_triggers_body_type_4_action_params = cls(
            annotators=annotators,
        )

        post_api_triggers_body_type_4_action_params.additional_properties = d
        return post_api_triggers_body_type_4_action_params

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
