from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_monitors_body_execution_mode import PostApiMonitorsBodyExecutionMode
from ..models.post_api_monitors_body_level import PostApiMonitorsBodyLevel
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_monitors_body_mappings import PostApiMonitorsBodyMappings
    from ..models.post_api_monitors_body_parameters import PostApiMonitorsBodyParameters
    from ..models.post_api_monitors_body_preconditions_item import PostApiMonitorsBodyPreconditionsItem


T = TypeVar("T", bound="PostApiMonitorsBody")


@_attrs_define
class PostApiMonitorsBody:
    """
    Attributes:
        name (str):
        check_type (str):
        mappings (PostApiMonitorsBodyMappings):
        execution_mode (PostApiMonitorsBodyExecutionMode | Unset):  Default:
            PostApiMonitorsBodyExecutionMode.ON_MESSAGE.
        preconditions (list[PostApiMonitorsBodyPreconditionsItem] | Unset):
        parameters (PostApiMonitorsBodyParameters | Unset):
        sample (float | Unset):  Default: 1.0.
        evaluator_id (str | Unset):
        level (PostApiMonitorsBodyLevel | Unset):  Default: PostApiMonitorsBodyLevel.TRACE.
        thread_idle_timeout (int | None | Unset):
    """

    name: str
    check_type: str
    mappings: PostApiMonitorsBodyMappings
    execution_mode: PostApiMonitorsBodyExecutionMode | Unset = PostApiMonitorsBodyExecutionMode.ON_MESSAGE
    preconditions: list[PostApiMonitorsBodyPreconditionsItem] | Unset = UNSET
    parameters: PostApiMonitorsBodyParameters | Unset = UNSET
    sample: float | Unset = 1.0
    evaluator_id: str | Unset = UNSET
    level: PostApiMonitorsBodyLevel | Unset = PostApiMonitorsBodyLevel.TRACE
    thread_idle_timeout: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        check_type = self.check_type

        mappings = self.mappings.to_dict()

        execution_mode: str | Unset = UNSET
        if not isinstance(self.execution_mode, Unset):
            execution_mode = self.execution_mode.value

        preconditions: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.preconditions, Unset):
            preconditions = []
            for preconditions_item_data in self.preconditions:
                preconditions_item = preconditions_item_data.to_dict()
                preconditions.append(preconditions_item)

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        sample = self.sample

        evaluator_id = self.evaluator_id

        level: str | Unset = UNSET
        if not isinstance(self.level, Unset):
            level = self.level.value

        thread_idle_timeout: int | None | Unset
        if isinstance(self.thread_idle_timeout, Unset):
            thread_idle_timeout = UNSET
        else:
            thread_idle_timeout = self.thread_idle_timeout

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "checkType": check_type,
                "mappings": mappings,
            }
        )
        if execution_mode is not UNSET:
            field_dict["executionMode"] = execution_mode
        if preconditions is not UNSET:
            field_dict["preconditions"] = preconditions
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if sample is not UNSET:
            field_dict["sample"] = sample
        if evaluator_id is not UNSET:
            field_dict["evaluatorId"] = evaluator_id
        if level is not UNSET:
            field_dict["level"] = level
        if thread_idle_timeout is not UNSET:
            field_dict["threadIdleTimeout"] = thread_idle_timeout

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_monitors_body_mappings import PostApiMonitorsBodyMappings
        from ..models.post_api_monitors_body_parameters import PostApiMonitorsBodyParameters
        from ..models.post_api_monitors_body_preconditions_item import PostApiMonitorsBodyPreconditionsItem

        d = dict(src_dict)
        name = d.pop("name")

        check_type = d.pop("checkType")

        mappings = PostApiMonitorsBodyMappings.from_dict(d.pop("mappings"))

        _execution_mode = d.pop("executionMode", UNSET)
        execution_mode: PostApiMonitorsBodyExecutionMode | Unset
        if isinstance(_execution_mode, Unset):
            execution_mode = UNSET
        else:
            execution_mode = PostApiMonitorsBodyExecutionMode(_execution_mode)

        _preconditions = d.pop("preconditions", UNSET)
        preconditions: list[PostApiMonitorsBodyPreconditionsItem] | Unset = UNSET
        if _preconditions is not UNSET:
            preconditions = []
            for preconditions_item_data in _preconditions:
                preconditions_item = PostApiMonitorsBodyPreconditionsItem.from_dict(preconditions_item_data)

                preconditions.append(preconditions_item)

        _parameters = d.pop("parameters", UNSET)
        parameters: PostApiMonitorsBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = PostApiMonitorsBodyParameters.from_dict(_parameters)

        sample = d.pop("sample", UNSET)

        evaluator_id = d.pop("evaluatorId", UNSET)

        _level = d.pop("level", UNSET)
        level: PostApiMonitorsBodyLevel | Unset
        if isinstance(_level, Unset):
            level = UNSET
        else:
            level = PostApiMonitorsBodyLevel(_level)

        def _parse_thread_idle_timeout(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        thread_idle_timeout = _parse_thread_idle_timeout(d.pop("threadIdleTimeout", UNSET))

        post_api_monitors_body = cls(
            name=name,
            check_type=check_type,
            mappings=mappings,
            execution_mode=execution_mode,
            preconditions=preconditions,
            parameters=parameters,
            sample=sample,
            evaluator_id=evaluator_id,
            level=level,
            thread_idle_timeout=thread_idle_timeout,
        )

        post_api_monitors_body.additional_properties = d
        return post_api_monitors_body

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
