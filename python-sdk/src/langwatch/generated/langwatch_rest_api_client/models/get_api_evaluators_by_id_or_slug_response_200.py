from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_evaluators_by_id_or_slug_response_200_config_type_0 import (
        GetApiEvaluatorsByIdOrSlugResponse200ConfigType0,
    )
    from ..models.get_api_evaluators_by_id_or_slug_response_200_fields_item import (
        GetApiEvaluatorsByIdOrSlugResponse200FieldsItem,
    )
    from ..models.get_api_evaluators_by_id_or_slug_response_200_output_fields_item import (
        GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem,
    )


T = TypeVar("T", bound="GetApiEvaluatorsByIdOrSlugResponse200")


@_attrs_define
class GetApiEvaluatorsByIdOrSlugResponse200:
    """
    Attributes:
        id (str):
        project_id (str):
        name (str):
        slug (None | str):
        type_ (str):
        config (GetApiEvaluatorsByIdOrSlugResponse200ConfigType0 | None):
        workflow_id (None | str):
        copied_from_evaluator_id (None | str):
        created_at (float | str):
        updated_at (float | str):
        fields (list[GetApiEvaluatorsByIdOrSlugResponse200FieldsItem]):
        output_fields (list[GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem]):
        workflow_name (str | Unset):
        workflow_icon (str | Unset):
    """

    id: str
    project_id: str
    name: str
    slug: None | str
    type_: str
    config: GetApiEvaluatorsByIdOrSlugResponse200ConfigType0 | None
    workflow_id: None | str
    copied_from_evaluator_id: None | str
    created_at: float | str
    updated_at: float | str
    fields: list[GetApiEvaluatorsByIdOrSlugResponse200FieldsItem]
    output_fields: list[GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem]
    workflow_name: str | Unset = UNSET
    workflow_icon: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_evaluators_by_id_or_slug_response_200_config_type_0 import (
            GetApiEvaluatorsByIdOrSlugResponse200ConfigType0,
        )

        id = self.id

        project_id = self.project_id

        name = self.name

        slug: None | str
        slug = self.slug

        type_ = self.type_

        config: dict[str, Any] | None
        if isinstance(self.config, GetApiEvaluatorsByIdOrSlugResponse200ConfigType0):
            config = self.config.to_dict()
        else:
            config = self.config

        workflow_id: None | str
        workflow_id = self.workflow_id

        copied_from_evaluator_id: None | str
        copied_from_evaluator_id = self.copied_from_evaluator_id

        created_at: float | str
        created_at = self.created_at

        updated_at: float | str
        updated_at = self.updated_at

        fields = []
        for fields_item_data in self.fields:
            fields_item = fields_item_data.to_dict()
            fields.append(fields_item)

        output_fields = []
        for output_fields_item_data in self.output_fields:
            output_fields_item = output_fields_item_data.to_dict()
            output_fields.append(output_fields_item)

        workflow_name = self.workflow_name

        workflow_icon = self.workflow_icon

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "projectId": project_id,
                "name": name,
                "slug": slug,
                "type": type_,
                "config": config,
                "workflowId": workflow_id,
                "copiedFromEvaluatorId": copied_from_evaluator_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "fields": fields,
                "outputFields": output_fields,
            }
        )
        if workflow_name is not UNSET:
            field_dict["workflowName"] = workflow_name
        if workflow_icon is not UNSET:
            field_dict["workflowIcon"] = workflow_icon

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_evaluators_by_id_or_slug_response_200_config_type_0 import (
            GetApiEvaluatorsByIdOrSlugResponse200ConfigType0,
        )
        from ..models.get_api_evaluators_by_id_or_slug_response_200_fields_item import (
            GetApiEvaluatorsByIdOrSlugResponse200FieldsItem,
        )
        from ..models.get_api_evaluators_by_id_or_slug_response_200_output_fields_item import (
            GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        name = d.pop("name")

        def _parse_slug(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        slug = _parse_slug(d.pop("slug"))

        type_ = d.pop("type")

        def _parse_config(data: object) -> GetApiEvaluatorsByIdOrSlugResponse200ConfigType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                config_type_0 = GetApiEvaluatorsByIdOrSlugResponse200ConfigType0.from_dict(data)

                return config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiEvaluatorsByIdOrSlugResponse200ConfigType0 | None, data)

        config = _parse_config(d.pop("config"))

        def _parse_workflow_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        workflow_id = _parse_workflow_id(d.pop("workflowId"))

        def _parse_copied_from_evaluator_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        copied_from_evaluator_id = _parse_copied_from_evaluator_id(d.pop("copiedFromEvaluatorId"))

        def _parse_created_at(data: object) -> float | str:
            return cast(float | str, data)

        created_at = _parse_created_at(d.pop("createdAt"))

        def _parse_updated_at(data: object) -> float | str:
            return cast(float | str, data)

        updated_at = _parse_updated_at(d.pop("updatedAt"))

        fields = []
        _fields = d.pop("fields")
        for fields_item_data in _fields:
            fields_item = GetApiEvaluatorsByIdOrSlugResponse200FieldsItem.from_dict(fields_item_data)

            fields.append(fields_item)

        output_fields = []
        _output_fields = d.pop("outputFields")
        for output_fields_item_data in _output_fields:
            output_fields_item = GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem.from_dict(
                output_fields_item_data
            )

            output_fields.append(output_fields_item)

        workflow_name = d.pop("workflowName", UNSET)

        workflow_icon = d.pop("workflowIcon", UNSET)

        get_api_evaluators_by_id_or_slug_response_200 = cls(
            id=id,
            project_id=project_id,
            name=name,
            slug=slug,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
            copied_from_evaluator_id=copied_from_evaluator_id,
            created_at=created_at,
            updated_at=updated_at,
            fields=fields,
            output_fields=output_fields,
            workflow_name=workflow_name,
            workflow_icon=workflow_icon,
        )

        get_api_evaluators_by_id_or_slug_response_200.additional_properties = d
        return get_api_evaluators_by_id_or_slug_response_200

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
