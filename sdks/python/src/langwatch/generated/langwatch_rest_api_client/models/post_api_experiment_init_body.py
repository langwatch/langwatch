from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_experiment_init_body_experiment_type import PostApiExperimentInitBodyExperimentType
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiExperimentInitBody")


@_attrs_define
class PostApiExperimentInitBody:
    """
    Attributes:
        experiment_type (PostApiExperimentInitBodyExperimentType):
        experiment_id (None | str | Unset):
        experiment_slug (None | str | Unset):
        experiment_name (str | Unset):
        workflow_id (str | Unset):
    """

    experiment_type: PostApiExperimentInitBodyExperimentType
    experiment_id: None | str | Unset = UNSET
    experiment_slug: None | str | Unset = UNSET
    experiment_name: str | Unset = UNSET
    workflow_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        experiment_type = self.experiment_type.value

        experiment_id: None | str | Unset
        if isinstance(self.experiment_id, Unset):
            experiment_id = UNSET
        else:
            experiment_id = self.experiment_id

        experiment_slug: None | str | Unset
        if isinstance(self.experiment_slug, Unset):
            experiment_slug = UNSET
        else:
            experiment_slug = self.experiment_slug

        experiment_name = self.experiment_name

        workflow_id = self.workflow_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "experiment_type": experiment_type,
            }
        )
        if experiment_id is not UNSET:
            field_dict["experiment_id"] = experiment_id
        if experiment_slug is not UNSET:
            field_dict["experiment_slug"] = experiment_slug
        if experiment_name is not UNSET:
            field_dict["experiment_name"] = experiment_name
        if workflow_id is not UNSET:
            field_dict["workflowId"] = workflow_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        experiment_type = PostApiExperimentInitBodyExperimentType(d.pop("experiment_type"))

        def _parse_experiment_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        experiment_id = _parse_experiment_id(d.pop("experiment_id", UNSET))

        def _parse_experiment_slug(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        experiment_slug = _parse_experiment_slug(d.pop("experiment_slug", UNSET))

        experiment_name = d.pop("experiment_name", UNSET)

        workflow_id = d.pop("workflowId", UNSET)

        post_api_experiment_init_body = cls(
            experiment_type=experiment_type,
            experiment_id=experiment_id,
            experiment_slug=experiment_slug,
            experiment_name=experiment_name,
            workflow_id=workflow_id,
        )

        post_api_experiment_init_body.additional_properties = d
        return post_api_experiment_init_body

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
