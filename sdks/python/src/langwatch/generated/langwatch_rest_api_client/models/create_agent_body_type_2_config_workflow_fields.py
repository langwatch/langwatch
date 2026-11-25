from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.create_agent_body_type_2_config_workflow_fields_input_fields_item import (
        CreateAgentBodyType2ConfigWorkflowFieldsInputFieldsItem,
    )
    from ..models.create_agent_body_type_2_config_workflow_fields_output_fields_item import (
        CreateAgentBodyType2ConfigWorkflowFieldsOutputFieldsItem,
    )


T = TypeVar("T", bound="CreateAgentBodyType2ConfigWorkflowFields")


@_attrs_define
class CreateAgentBodyType2ConfigWorkflowFields:
    """
    Attributes:
        input_fields (list[CreateAgentBodyType2ConfigWorkflowFieldsInputFieldsItem]):
        output_fields (list[CreateAgentBodyType2ConfigWorkflowFieldsOutputFieldsItem]):
        fields_resolved (bool):
        recorded_at (int):
    """

    input_fields: list[CreateAgentBodyType2ConfigWorkflowFieldsInputFieldsItem]
    output_fields: list[CreateAgentBodyType2ConfigWorkflowFieldsOutputFieldsItem]
    fields_resolved: bool
    recorded_at: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        input_fields = []
        for input_fields_item_data in self.input_fields:
            input_fields_item = input_fields_item_data.to_dict()
            input_fields.append(input_fields_item)

        output_fields = []
        for output_fields_item_data in self.output_fields:
            output_fields_item = output_fields_item_data.to_dict()
            output_fields.append(output_fields_item)

        fields_resolved = self.fields_resolved

        recorded_at = self.recorded_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "inputFields": input_fields,
                "outputFields": output_fields,
                "fieldsResolved": fields_resolved,
                "recordedAt": recorded_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_2_config_workflow_fields_input_fields_item import (
            CreateAgentBodyType2ConfigWorkflowFieldsInputFieldsItem,
        )
        from ..models.create_agent_body_type_2_config_workflow_fields_output_fields_item import (
            CreateAgentBodyType2ConfigWorkflowFieldsOutputFieldsItem,
        )

        d = dict(src_dict)
        input_fields = []
        _input_fields = d.pop("inputFields")
        for input_fields_item_data in _input_fields:
            input_fields_item = CreateAgentBodyType2ConfigWorkflowFieldsInputFieldsItem.from_dict(
                input_fields_item_data
            )

            input_fields.append(input_fields_item)

        output_fields = []
        _output_fields = d.pop("outputFields")
        for output_fields_item_data in _output_fields:
            output_fields_item = CreateAgentBodyType2ConfigWorkflowFieldsOutputFieldsItem.from_dict(
                output_fields_item_data
            )

            output_fields.append(output_fields_item)

        fields_resolved = d.pop("fieldsResolved")

        recorded_at = d.pop("recordedAt")

        create_agent_body_type_2_config_workflow_fields = cls(
            input_fields=input_fields,
            output_fields=output_fields,
            fields_resolved=fields_resolved,
            recorded_at=recorded_at,
        )

        create_agent_body_type_2_config_workflow_fields.additional_properties = d
        return create_agent_body_type_2_config_workflow_fields

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
