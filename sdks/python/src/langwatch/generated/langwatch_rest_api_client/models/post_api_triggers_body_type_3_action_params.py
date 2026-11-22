from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_triggers_body_type_3_action_params_dataset_mapping import (
        PostApiTriggersBodyType3ActionParamsDatasetMapping,
    )


T = TypeVar("T", bound="PostApiTriggersBodyType3ActionParams")


@_attrs_define
class PostApiTriggersBodyType3ActionParams:
    """Append matched traces to a dataset.

    Attributes:
        dataset_id (str): The dataset matched traces are appended to.
        dataset_mapping (PostApiTriggersBodyType3ActionParamsDatasetMapping): How a trace becomes a row in that dataset.
    """

    dataset_id: str
    dataset_mapping: PostApiTriggersBodyType3ActionParamsDatasetMapping
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
        from ..models.post_api_triggers_body_type_3_action_params_dataset_mapping import (
            PostApiTriggersBodyType3ActionParamsDatasetMapping,
        )

        d = dict(src_dict)
        dataset_id = d.pop("datasetId")

        dataset_mapping = PostApiTriggersBodyType3ActionParamsDatasetMapping.from_dict(d.pop("datasetMapping"))

        post_api_triggers_body_type_3_action_params = cls(
            dataset_id=dataset_id,
            dataset_mapping=dataset_mapping,
        )

        post_api_triggers_body_type_3_action_params.additional_properties = d
        return post_api_triggers_body_type_3_action_params

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
