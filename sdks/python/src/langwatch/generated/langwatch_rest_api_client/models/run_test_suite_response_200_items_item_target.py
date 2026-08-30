from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.run_test_suite_response_200_items_item_target_type import RunTestSuiteResponse200ItemsItemTargetType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.run_test_suite_response_200_items_item_target_run_parameters import (
        RunTestSuiteResponse200ItemsItemTargetRunParameters,
    )


T = TypeVar("T", bound="RunTestSuiteResponse200ItemsItemTarget")


@_attrs_define
class RunTestSuiteResponse200ItemsItemTarget:
    """What it was run against.

    Attributes:
        type_ (RunTestSuiteResponse200ItemsItemTargetType): What kind of thing the scenarios run against.
        reference_id (str): The id of the prompt, agent or workflow to run against.
        run_parameters (RunTestSuiteResponse200ItemsItemTargetRunParameters | Unset): Parameter values this target alone
            runs with, by name. They are merged over the run-level parameters and the target wins, so two targets may name
            the same agent with different values: that is how one run compares one agent on two models, and the results show
            one column for each target.
    """

    type_: RunTestSuiteResponse200ItemsItemTargetType
    reference_id: str
    run_parameters: RunTestSuiteResponse200ItemsItemTargetRunParameters | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        reference_id = self.reference_id

        run_parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.run_parameters, Unset):
            run_parameters = self.run_parameters.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "referenceId": reference_id,
            }
        )
        if run_parameters is not UNSET:
            field_dict["runParameters"] = run_parameters

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.run_test_suite_response_200_items_item_target_run_parameters import (
            RunTestSuiteResponse200ItemsItemTargetRunParameters,
        )

        d = dict(src_dict)
        type_ = RunTestSuiteResponse200ItemsItemTargetType(d.pop("type"))

        reference_id = d.pop("referenceId")

        _run_parameters = d.pop("runParameters", UNSET)
        run_parameters: RunTestSuiteResponse200ItemsItemTargetRunParameters | Unset
        if isinstance(_run_parameters, Unset):
            run_parameters = UNSET
        else:
            run_parameters = RunTestSuiteResponse200ItemsItemTargetRunParameters.from_dict(_run_parameters)

        run_test_suite_response_200_items_item_target = cls(
            type_=type_,
            reference_id=reference_id,
            run_parameters=run_parameters,
        )

        run_test_suite_response_200_items_item_target.additional_properties = d
        return run_test_suite_response_200_items_item_target

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
