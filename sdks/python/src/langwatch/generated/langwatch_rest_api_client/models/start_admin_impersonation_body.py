from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="StartAdminImpersonationBody")


@_attrs_define
class StartAdminImpersonationBody:
    """
    Attributes:
        user_id_to_impersonate (str):
        reason (str):
    """

    user_id_to_impersonate: str
    reason: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        user_id_to_impersonate = self.user_id_to_impersonate

        reason = self.reason

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "userIdToImpersonate": user_id_to_impersonate,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        user_id_to_impersonate = d.pop("userIdToImpersonate")

        reason = d.pop("reason")

        start_admin_impersonation_body = cls(
            user_id_to_impersonate=user_id_to_impersonate,
            reason=reason,
        )

        start_admin_impersonation_body.additional_properties = d
        return start_admin_impersonation_body

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
