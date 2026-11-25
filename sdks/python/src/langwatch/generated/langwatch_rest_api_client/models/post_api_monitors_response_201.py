from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_monitors_response_201_execution_mode import PostApiMonitorsResponse201ExecutionMode

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
        preconditions (Any):
        parameters (Any):
        mappings (Any | None):
        thread_idle_timeout (float | None):
        created_at (str):
        updated_at (str):
        auto_paused_at (None | str): When the monitor paused itself because its evaluations mostly failed.
        auto_paused_reason (None | str): Why the monitor paused itself.
        evaluator_label (None | str): The evaluator deploy label the monitor runs; null runs the latest version.
        created_by_id (None | str): The user who created the monitor, when recorded.
        updated_by_id (None | str): The user who changed the monitor last.
        platform_url (str):
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
    preconditions: Any
    parameters: Any
    mappings: Any | None
    thread_idle_timeout: float | None
    created_at: str
    updated_at: str
    auto_paused_at: None | str
    auto_paused_reason: None | str
    evaluator_label: None | str
    created_by_id: None | str
    updated_by_id: None | str
    platform_url: str

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

        preconditions = self.preconditions

        parameters = self.parameters

        mappings: Any | None
        mappings = self.mappings

        thread_idle_timeout: float | None
        thread_idle_timeout = self.thread_idle_timeout

        created_at = self.created_at

        updated_at = self.updated_at

        auto_paused_at: None | str
        auto_paused_at = self.auto_paused_at

        auto_paused_reason: None | str
        auto_paused_reason = self.auto_paused_reason

        evaluator_label: None | str
        evaluator_label = self.evaluator_label

        created_by_id: None | str
        created_by_id = self.created_by_id

        updated_by_id: None | str
        updated_by_id = self.updated_by_id

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}

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
                "preconditions": preconditions,
                "parameters": parameters,
                "mappings": mappings,
                "threadIdleTimeout": thread_idle_timeout,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "autoPausedAt": auto_paused_at,
                "autoPausedReason": auto_paused_reason,
                "evaluatorLabel": evaluator_label,
                "createdById": created_by_id,
                "updatedById": updated_by_id,
                "platformUrl": platform_url,
            }
        )

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

        preconditions = d.pop("preconditions")

        parameters = d.pop("parameters")

        def _parse_mappings(data: object) -> Any | None:
            if data is None:
                return data
            return cast(Any | None, data)

        mappings = _parse_mappings(d.pop("mappings"))

        def _parse_thread_idle_timeout(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        thread_idle_timeout = _parse_thread_idle_timeout(d.pop("threadIdleTimeout"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        def _parse_auto_paused_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        auto_paused_at = _parse_auto_paused_at(d.pop("autoPausedAt"))

        def _parse_auto_paused_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        auto_paused_reason = _parse_auto_paused_reason(d.pop("autoPausedReason"))

        def _parse_evaluator_label(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        evaluator_label = _parse_evaluator_label(d.pop("evaluatorLabel"))

        def _parse_created_by_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by_id = _parse_created_by_id(d.pop("createdById"))

        def _parse_updated_by_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        updated_by_id = _parse_updated_by_id(d.pop("updatedById"))

        platform_url = d.pop("platformUrl")

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
            preconditions=preconditions,
            parameters=parameters,
            mappings=mappings,
            thread_idle_timeout=thread_idle_timeout,
            created_at=created_at,
            updated_at=updated_at,
            auto_paused_at=auto_paused_at,
            auto_paused_reason=auto_paused_reason,
            evaluator_label=evaluator_label,
            created_by_id=created_by_id,
            updated_by_id=updated_by_id,
            platform_url=platform_url,
        )

        return post_api_monitors_response_201
