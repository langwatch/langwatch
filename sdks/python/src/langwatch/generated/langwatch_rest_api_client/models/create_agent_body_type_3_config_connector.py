from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_agent_body_type_3_config_connector_setup import CreateAgentBodyType3ConfigConnectorSetup
    from ..models.create_agent_body_type_3_config_connector_teardown import CreateAgentBodyType3ConfigConnectorTeardown


T = TypeVar("T", bound="CreateAgentBodyType3ConfigConnector")


@_attrs_define
class CreateAgentBodyType3ConfigConnector:
    """
    Attributes:
        setup (CreateAgentBodyType3ConfigConnectorSetup | Unset):
        teardown (CreateAgentBodyType3ConfigConnectorTeardown | Unset):
    """

    setup: CreateAgentBodyType3ConfigConnectorSetup | Unset = UNSET
    teardown: CreateAgentBodyType3ConfigConnectorTeardown | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        setup: dict[str, Any] | Unset = UNSET
        if not isinstance(self.setup, Unset):
            setup = self.setup.to_dict()

        teardown: dict[str, Any] | Unset = UNSET
        if not isinstance(self.teardown, Unset):
            teardown = self.teardown.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if setup is not UNSET:
            field_dict["setup"] = setup
        if teardown is not UNSET:
            field_dict["teardown"] = teardown

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_agent_body_type_3_config_connector_setup import CreateAgentBodyType3ConfigConnectorSetup
        from ..models.create_agent_body_type_3_config_connector_teardown import (
            CreateAgentBodyType3ConfigConnectorTeardown,
        )

        d = dict(src_dict)
        _setup = d.pop("setup", UNSET)
        setup: CreateAgentBodyType3ConfigConnectorSetup | Unset
        if isinstance(_setup, Unset):
            setup = UNSET
        else:
            setup = CreateAgentBodyType3ConfigConnectorSetup.from_dict(_setup)

        _teardown = d.pop("teardown", UNSET)
        teardown: CreateAgentBodyType3ConfigConnectorTeardown | Unset
        if isinstance(_teardown, Unset):
            teardown = UNSET
        else:
            teardown = CreateAgentBodyType3ConfigConnectorTeardown.from_dict(_teardown)

        create_agent_body_type_3_config_connector = cls(
            setup=setup,
            teardown=teardown,
        )

        create_agent_body_type_3_config_connector.additional_properties = d
        return create_agent_body_type_3_config_connector

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
