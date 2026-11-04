from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_evaluators_by_id_or_slug_response_200_config_type_0 import (
        GetApiEvaluatorsByIdOrSlugResponse200ConfigType0,
    )
    from ..models.get_api_evaluators_by_id_or_slug_response_200_created_by_type_0 import (
        GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0,
    )
    from ..models.get_api_evaluators_by_id_or_slug_response_200_fields_item import (
        GetApiEvaluatorsByIdOrSlugResponse200FieldsItem,
    )
    from ..models.get_api_evaluators_by_id_or_slug_response_200_labels_item import (
        GetApiEvaluatorsByIdOrSlugResponse200LabelsItem,
    )
    from ..models.get_api_evaluators_by_id_or_slug_response_200_output_fields_item import (
        GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem,
    )
    from ..models.get_api_evaluators_by_id_or_slug_response_200_updated_by_type_0 import (
        GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0,
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
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        fields (list[GetApiEvaluatorsByIdOrSlugResponse200FieldsItem]):
        output_fields (list[GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem]):
        version (int | None): The version this response shows: the latest, unless a label or a version was asked for.
        labels (list[GetApiEvaluatorsByIdOrSlugResponse200LabelsItem]): The deploy labels the evaluator carries, such as
            production, and the version each points at.
        created_by (GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0 | None): The user who created the evaluator.
            Null when an API key created it, or it predates creators being recorded.
        updated_by (GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0 | None): The user who changed the evaluator
            last. Null when an API key changed it.
        platform_url (str):
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
    created_at: datetime.datetime
    updated_at: datetime.datetime
    fields: list[GetApiEvaluatorsByIdOrSlugResponse200FieldsItem]
    output_fields: list[GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem]
    version: int | None
    labels: list[GetApiEvaluatorsByIdOrSlugResponse200LabelsItem]
    created_by: GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0 | None
    updated_by: GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0 | None
    platform_url: str
    workflow_name: str | Unset = UNSET
    workflow_icon: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_evaluators_by_id_or_slug_response_200_config_type_0 import (
            GetApiEvaluatorsByIdOrSlugResponse200ConfigType0,
        )
        from ..models.get_api_evaluators_by_id_or_slug_response_200_created_by_type_0 import (
            GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0,
        )
        from ..models.get_api_evaluators_by_id_or_slug_response_200_updated_by_type_0 import (
            GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0,
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

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        fields = []
        for fields_item_data in self.fields:
            fields_item = fields_item_data.to_dict()
            fields.append(fields_item)

        output_fields = []
        for output_fields_item_data in self.output_fields:
            output_fields_item = output_fields_item_data.to_dict()
            output_fields.append(output_fields_item)

        version: int | None
        version = self.version

        labels = []
        for labels_item_data in self.labels:
            labels_item = labels_item_data.to_dict()
            labels.append(labels_item)

        created_by: dict[str, Any] | None
        if isinstance(self.created_by, GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0):
            created_by = self.created_by.to_dict()
        else:
            created_by = self.created_by

        updated_by: dict[str, Any] | None
        if isinstance(self.updated_by, GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0):
            updated_by = self.updated_by.to_dict()
        else:
            updated_by = self.updated_by

        platform_url = self.platform_url

        workflow_name = self.workflow_name

        workflow_icon = self.workflow_icon

        field_dict: dict[str, Any] = {}

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
                "version": version,
                "labels": labels,
                "createdBy": created_by,
                "updatedBy": updated_by,
                "platformUrl": platform_url,
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
        from ..models.get_api_evaluators_by_id_or_slug_response_200_created_by_type_0 import (
            GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0,
        )
        from ..models.get_api_evaluators_by_id_or_slug_response_200_fields_item import (
            GetApiEvaluatorsByIdOrSlugResponse200FieldsItem,
        )
        from ..models.get_api_evaluators_by_id_or_slug_response_200_labels_item import (
            GetApiEvaluatorsByIdOrSlugResponse200LabelsItem,
        )
        from ..models.get_api_evaluators_by_id_or_slug_response_200_output_fields_item import (
            GetApiEvaluatorsByIdOrSlugResponse200OutputFieldsItem,
        )
        from ..models.get_api_evaluators_by_id_or_slug_response_200_updated_by_type_0 import (
            GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0,
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

        created_at = isoparse(d.pop("createdAt"))

        updated_at = isoparse(d.pop("updatedAt"))

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

        def _parse_version(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        version = _parse_version(d.pop("version"))

        labels = []
        _labels = d.pop("labels")
        for labels_item_data in _labels:
            labels_item = GetApiEvaluatorsByIdOrSlugResponse200LabelsItem.from_dict(labels_item_data)

            labels.append(labels_item)

        def _parse_created_by(data: object) -> GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                created_by_type_0 = GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0.from_dict(data)

                return created_by_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiEvaluatorsByIdOrSlugResponse200CreatedByType0 | None, data)

        created_by = _parse_created_by(d.pop("createdBy"))

        def _parse_updated_by(data: object) -> GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                updated_by_type_0 = GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0.from_dict(data)

                return updated_by_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiEvaluatorsByIdOrSlugResponse200UpdatedByType0 | None, data)

        updated_by = _parse_updated_by(d.pop("updatedBy"))

        platform_url = d.pop("platformUrl")

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
            version=version,
            labels=labels,
            created_by=created_by,
            updated_by=updated_by,
            platform_url=platform_url,
            workflow_name=workflow_name,
            workflow_icon=workflow_icon,
        )

        return get_api_evaluators_by_id_or_slug_response_200
