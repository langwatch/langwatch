from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.rerun_run_plan_body_parameters import RerunRunPlanBodyParameters


T = TypeVar("T", bound="RerunRunPlanBody")


@_attrs_define
class RerunRunPlanBody:
    """
    Attributes:
        idempotency_key (str | Unset): Repeat the same key to make a retry join the batch the first call started instead
            of running everything again. Defaults to a new key per call.
        parameters (RerunRunPlanBodyParameters | Unset): Constant values applied to every scenario in the run, e.g. a
            fixture id or a tenant. A value supplied here overrides the scenario's own default for that name.
        note (str | Unset): One short line describing why this batch was run, e.g. a commit hash or what you changed. It
            is stored on every run of the batch and shown beside the run in the platform. Up to 200 characters.
    """

    idempotency_key: str | Unset = UNSET
    parameters: RerunRunPlanBodyParameters | Unset = UNSET
    note: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        idempotency_key = self.idempotency_key

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        note = self.note

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if idempotency_key is not UNSET:
            field_dict["idempotencyKey"] = idempotency_key
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if note is not UNSET:
            field_dict["note"] = note

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.rerun_run_plan_body_parameters import RerunRunPlanBodyParameters

        d = dict(src_dict)
        idempotency_key = d.pop("idempotencyKey", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: RerunRunPlanBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = RerunRunPlanBodyParameters.from_dict(_parameters)

        note = d.pop("note", UNSET)

        rerun_run_plan_body = cls(
            idempotency_key=idempotency_key,
            parameters=parameters,
            note=note,
        )

        rerun_run_plan_body.additional_properties = d
        return rerun_run_plan_body

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
