from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.approve_langy_control_request_body_workspace import ApproveLangyControlRequestBodyWorkspace


T = TypeVar("T", bound="ApproveLangyControlRequestBody")


@_attrs_define
class ApproveLangyControlRequestBody:
    """
    Attributes:
        workspace (ApproveLangyControlRequestBodyWorkspace):
    """

    workspace: ApproveLangyControlRequestBodyWorkspace
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        workspace = self.workspace.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "workspace": workspace,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.approve_langy_control_request_body_workspace import ApproveLangyControlRequestBodyWorkspace

        d = dict(src_dict)
        workspace = ApproveLangyControlRequestBodyWorkspace.from_dict(d.pop("workspace"))

        approve_langy_control_request_body = cls(
            workspace=workspace,
        )

        approve_langy_control_request_body.additional_properties = d
        return approve_langy_control_request_body

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
