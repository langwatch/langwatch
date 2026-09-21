from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_monitors_response_201_execution_mode import PostApiMonitorsResponse201ExecutionMode
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiMonitorsResponse201")


@_attrs_define
class PostApiMonitorsResponse201:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        check_type (str):
        enabled (bool):
        execution_mode (PostApiMonitorsResponse201ExecutionMode):
        sample (float):
        level (str):
        evaluator_id (None | str):
        thread_idle_timeout (float | None):
        created_at (str):
        updated_at (str):
        platform_url (str):
        preconditions (Any | Unset):
        parameters (Any | Unset):
        mappings (None | Unset):
    """

    id: str
    name: str
    slug: str
    check_type: str
    enabled: bool
    execution_mode: PostApiMonitorsResponse201ExecutionMode
    sample: float
    level: str
    evaluator_id: None | str
    thread_idle_timeout: float | None
    created_at: str
    updated_at: str
    platform_url: str
    preconditions: Any | Unset = UNSET
    parameters: Any | Unset = UNSET
    mappings: None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        check_type = self.check_type

        enabled = self.enabled

        execution_mode = self.execution_mode.value

        sample = self.sample

        level = self.level

        evaluator_id: None | str
        evaluator_id = self.evaluator_id

        thread_idle_timeout: float | None
        thread_idle_timeout = self.thread_idle_timeout

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        preconditions = self.preconditions

        parameters = self.parameters

        mappings = self.mappings

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "checkType": check_type,
                "enabled": enabled,
                "executionMode": execution_mode,
                "sample": sample,
                "level": level,
                "evaluatorId": evaluator_id,
                "threadIdleTimeout": thread_idle_timeout,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
            }
        )
        if preconditions is not UNSET:
            field_dict["preconditions"] = preconditions
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if mappings is not UNSET:
            field_dict["mappings"] = mappings

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        check_type = d.pop("checkType")

        enabled = d.pop("enabled")

        execution_mode = PostApiMonitorsResponse201ExecutionMode(d.pop("executionMode"))

        sample = d.pop("sample")

        level = d.pop("level")

        def _parse_evaluator_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        evaluator_id = _parse_evaluator_id(d.pop("evaluatorId"))

        def _parse_thread_idle_timeout(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        thread_idle_timeout = _parse_thread_idle_timeout(d.pop("threadIdleTimeout"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        preconditions = d.pop("preconditions", UNSET)

        parameters = d.pop("parameters", UNSET)

        mappings = d.pop("mappings", UNSET)

        post_api_monitors_response_201 = cls(
            id=id,
            name=name,
            slug=slug,
            check_type=check_type,
            enabled=enabled,
            execution_mode=execution_mode,
            sample=sample,
            level=level,
            evaluator_id=evaluator_id,
            thread_idle_timeout=thread_idle_timeout,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
            preconditions=preconditions,
            parameters=parameters,
            mappings=mappings,
        )

        post_api_monitors_response_201.additional_properties = d
        return post_api_monitors_response_201

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
