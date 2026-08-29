from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_suites_response_200_item_targets_item_type import GetApiSuitesResponse200ItemTargetsItemType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_suites_response_200_item_targets_item_run_parameters import (
        GetApiSuitesResponse200ItemTargetsItemRunParameters,
    )


T = TypeVar("T", bound="GetApiSuitesResponse200ItemTargetsItem")


@_attrs_define
class GetApiSuitesResponse200ItemTargetsItem:
    """
    Attributes:
        type_ (GetApiSuitesResponse200ItemTargetsItemType): What kind of thing the scenarios run against.
        reference_id (str): The id of the prompt, agent or workflow to run against.
        run_parameters (GetApiSuitesResponse200ItemTargetsItemRunParameters | Unset): Parameter values this target alone
            runs with, by name. They are merged over the run-level parameters and the target wins, so two targets may name
            the same agent with different values: that is how one run compares one agent on two models, and the results show
            one column for each target.
    """

    type_: GetApiSuitesResponse200ItemTargetsItemType
    reference_id: str
    run_parameters: GetApiSuitesResponse200ItemTargetsItemRunParameters | Unset = UNSET
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
        from ..models.get_api_suites_response_200_item_targets_item_run_parameters import (
            GetApiSuitesResponse200ItemTargetsItemRunParameters,
        )

        d = dict(src_dict)
        type_ = GetApiSuitesResponse200ItemTargetsItemType(d.pop("type"))

        reference_id = d.pop("referenceId")

        _run_parameters = d.pop("runParameters", UNSET)
        run_parameters: GetApiSuitesResponse200ItemTargetsItemRunParameters | Unset
        if isinstance(_run_parameters, Unset):
            run_parameters = UNSET
        else:
            run_parameters = GetApiSuitesResponse200ItemTargetsItemRunParameters.from_dict(_run_parameters)

        get_api_suites_response_200_item_targets_item = cls(
            type_=type_,
            reference_id=reference_id,
            run_parameters=run_parameters,
        )

        get_api_suites_response_200_item_targets_item.additional_properties = d
        return get_api_suites_response_200_item_targets_item

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
