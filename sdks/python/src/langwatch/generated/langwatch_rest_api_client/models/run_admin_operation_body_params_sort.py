from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.run_admin_operation_body_params_sort_order import RunAdminOperationBodyParamsSortOrder
from ..types import UNSET, Unset

T = TypeVar("T", bound="RunAdminOperationBodyParamsSort")


@_attrs_define
class RunAdminOperationBodyParamsSort:
    """
    Attributes:
        field (str | Unset):
        order (RunAdminOperationBodyParamsSortOrder | Unset):
    """

    field: str | Unset = UNSET
    order: RunAdminOperationBodyParamsSortOrder | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        field = self.field

        order: str | Unset = UNSET
        if not isinstance(self.order, Unset):
            order = self.order.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if field is not UNSET:
            field_dict["field"] = field
        if order is not UNSET:
            field_dict["order"] = order

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field = d.pop("field", UNSET)

        _order = d.pop("order", UNSET)
        order: RunAdminOperationBodyParamsSortOrder | Unset
        if isinstance(_order, Unset):
            order = UNSET
        else:
            order = RunAdminOperationBodyParamsSortOrder(_order)

        run_admin_operation_body_params_sort = cls(
            field=field,
            order=order,
        )

        run_admin_operation_body_params_sort.additional_properties = d
        return run_admin_operation_body_params_sort

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
