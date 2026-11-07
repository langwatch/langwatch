from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="CreateAgentBodyType3ConfigHooks")


@_attrs_define
class CreateAgentBodyType3ConfigHooks:
    """
    Attributes:
        setup (bool):
        teardown (bool):
    """

    setup: bool
    teardown: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        setup = self.setup

        teardown = self.teardown

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "setup": setup,
                "teardown": teardown,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        setup = d.pop("setup")

        teardown = d.pop("teardown")

        create_agent_body_type_3_config_hooks = cls(
            setup=setup,
            teardown=teardown,
        )

        create_agent_body_type_3_config_hooks.additional_properties = d
        return create_agent_body_type_3_config_hooks

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
