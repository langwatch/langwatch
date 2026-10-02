from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.run_admin_operation_body_method import RunAdminOperationBodyMethod
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.run_admin_operation_body_params import RunAdminOperationBodyParams


T = TypeVar("T", bound="RunAdminOperationBody")


@_attrs_define
class RunAdminOperationBody:
    """
    Attributes:
        method (RunAdminOperationBodyMethod):
        params (RunAdminOperationBodyParams | Unset):
    """

    method: RunAdminOperationBodyMethod
    params: RunAdminOperationBodyParams | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        method = self.method.value

        params: dict[str, Any] | Unset = UNSET
        if not isinstance(self.params, Unset):
            params = self.params.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "method": method,
            }
        )
        if params is not UNSET:
            field_dict["params"] = params

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.run_admin_operation_body_params import RunAdminOperationBodyParams

        d = dict(src_dict)
        method = RunAdminOperationBodyMethod(d.pop("method"))

        _params = d.pop("params", UNSET)
        params: RunAdminOperationBodyParams | Unset
        if isinstance(_params, Unset):
            params = UNSET
        else:
            params = RunAdminOperationBodyParams.from_dict(_params)

        run_admin_operation_body = cls(
            method=method,
            params=params,
        )

        run_admin_operation_body.additional_properties = d
        return run_admin_operation_body

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
