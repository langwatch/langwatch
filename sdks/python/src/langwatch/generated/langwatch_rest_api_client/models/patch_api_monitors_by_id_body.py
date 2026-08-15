from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_monitors_by_id_body_execution_mode import PatchApiMonitorsByIdBodyExecutionMode
from ..models.patch_api_monitors_by_id_body_level import PatchApiMonitorsByIdBodyLevel
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_monitors_by_id_body_mappings_type_0 import PatchApiMonitorsByIdBodyMappingsType0
    from ..models.patch_api_monitors_by_id_body_parameters import PatchApiMonitorsByIdBodyParameters


T = TypeVar("T", bound="PatchApiMonitorsByIdBody")


@_attrs_define
class PatchApiMonitorsByIdBody:
    """
    Attributes:
        name (str | Unset):
        enabled (bool | Unset):
        check_type (str | Unset):
        execution_mode (PatchApiMonitorsByIdBodyExecutionMode | Unset):
        preconditions (list[Any] | Unset):
        parameters (PatchApiMonitorsByIdBodyParameters | Unset):
        mappings (None | PatchApiMonitorsByIdBodyMappingsType0 | Unset):
        sample (float | Unset):
        evaluator_id (None | str | Unset):
        level (PatchApiMonitorsByIdBodyLevel | Unset):
        thread_idle_timeout (int | None | Unset):
    """

    name: str | Unset = UNSET
    enabled: bool | Unset = UNSET
    check_type: str | Unset = UNSET
    execution_mode: PatchApiMonitorsByIdBodyExecutionMode | Unset = UNSET
    preconditions: list[Any] | Unset = UNSET
    parameters: PatchApiMonitorsByIdBodyParameters | Unset = UNSET
    mappings: None | PatchApiMonitorsByIdBodyMappingsType0 | Unset = UNSET
    sample: float | Unset = UNSET
    evaluator_id: None | str | Unset = UNSET
    level: PatchApiMonitorsByIdBodyLevel | Unset = UNSET
    thread_idle_timeout: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_api_monitors_by_id_body_mappings_type_0 import PatchApiMonitorsByIdBodyMappingsType0

        name = self.name

        enabled = self.enabled

        check_type = self.check_type

        execution_mode: str | Unset = UNSET
        if not isinstance(self.execution_mode, Unset):
            execution_mode = self.execution_mode.value

        preconditions: list[Any] | Unset = UNSET
        if not isinstance(self.preconditions, Unset):
            preconditions = self.preconditions

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        mappings: dict[str, Any] | None | Unset
        if isinstance(self.mappings, Unset):
            mappings = UNSET
        elif isinstance(self.mappings, PatchApiMonitorsByIdBodyMappingsType0):
            mappings = self.mappings.to_dict()
        else:
            mappings = self.mappings

        sample = self.sample

        evaluator_id: None | str | Unset
        if isinstance(self.evaluator_id, Unset):
            evaluator_id = UNSET
        else:
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
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if check_type is not UNSET:
            field_dict["checkType"] = check_type
        if execution_mode is not UNSET:
            field_dict["executionMode"] = execution_mode
        if preconditions is not UNSET:
            field_dict["preconditions"] = preconditions
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if mappings is not UNSET:
            field_dict["mappings"] = mappings
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
        from ..models.patch_api_monitors_by_id_body_mappings_type_0 import PatchApiMonitorsByIdBodyMappingsType0
        from ..models.patch_api_monitors_by_id_body_parameters import PatchApiMonitorsByIdBodyParameters

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        enabled = d.pop("enabled", UNSET)

        check_type = d.pop("checkType", UNSET)

        _execution_mode = d.pop("executionMode", UNSET)
        execution_mode: PatchApiMonitorsByIdBodyExecutionMode | Unset
        if isinstance(_execution_mode, Unset):
            execution_mode = UNSET
        else:
            execution_mode = PatchApiMonitorsByIdBodyExecutionMode(_execution_mode)

        preconditions = cast(list[Any], d.pop("preconditions", UNSET))

        _parameters = d.pop("parameters", UNSET)
        parameters: PatchApiMonitorsByIdBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = PatchApiMonitorsByIdBodyParameters.from_dict(_parameters)

        def _parse_mappings(data: object) -> None | PatchApiMonitorsByIdBodyMappingsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                mappings_type_0 = PatchApiMonitorsByIdBodyMappingsType0.from_dict(data)

                return mappings_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PatchApiMonitorsByIdBodyMappingsType0 | Unset, data)

        mappings = _parse_mappings(d.pop("mappings", UNSET))

        sample = d.pop("sample", UNSET)

        def _parse_evaluator_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        evaluator_id = _parse_evaluator_id(d.pop("evaluatorId", UNSET))

        _level = d.pop("level", UNSET)
        level: PatchApiMonitorsByIdBodyLevel | Unset
        if isinstance(_level, Unset):
            level = UNSET
        else:
            level = PatchApiMonitorsByIdBodyLevel(_level)

        def _parse_thread_idle_timeout(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        thread_idle_timeout = _parse_thread_idle_timeout(d.pop("threadIdleTimeout", UNSET))

        patch_api_monitors_by_id_body = cls(
            name=name,
            enabled=enabled,
            check_type=check_type,
            execution_mode=execution_mode,
            preconditions=preconditions,
            parameters=parameters,
            mappings=mappings,
            sample=sample,
            evaluator_id=evaluator_id,
            level=level,
            thread_idle_timeout=thread_idle_timeout,
        )

        patch_api_monitors_by_id_body.additional_properties = d
        return patch_api_monitors_by_id_body

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
