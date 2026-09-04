from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.replace_agent_body_type import ReplaceAgentBodyType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.replace_agent_body_config import ReplaceAgentBodyConfig


T = TypeVar("T", bound="ReplaceAgentBody")


@_attrs_define
class ReplaceAgentBody:
    """
    Attributes:
        name (str | Unset):
        type_ (ReplaceAgentBodyType | Unset): The kind of agent to write. A connected agent is registered from code by
            the SDK, so "connected" is refused with agent_register_only.
        config (ReplaceAgentBodyConfig | Unset):
        workflow_id (None | str | Unset):
    """

    name: str | Unset = UNSET
    type_: ReplaceAgentBodyType | Unset = UNSET
    config: ReplaceAgentBodyConfig | Unset = UNSET
    workflow_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value

        config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.config, Unset):
            config = self.config.to_dict()

        workflow_id: None | str | Unset
        if isinstance(self.workflow_id, Unset):
            workflow_id = UNSET
        else:
            workflow_id = self.workflow_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if type_ is not UNSET:
            field_dict["type"] = type_
        if config is not UNSET:
            field_dict["config"] = config
        if workflow_id is not UNSET:
            field_dict["workflowId"] = workflow_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.replace_agent_body_config import ReplaceAgentBodyConfig

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _type_ = d.pop("type", UNSET)
        type_: ReplaceAgentBodyType | Unset
        if isinstance(_type_, Unset):
            type_ = UNSET
        else:
            type_ = ReplaceAgentBodyType(_type_)

        _config = d.pop("config", UNSET)
        config: ReplaceAgentBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = ReplaceAgentBodyConfig.from_dict(_config)

        def _parse_workflow_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        workflow_id = _parse_workflow_id(d.pop("workflowId", UNSET))

        replace_agent_body = cls(
            name=name,
            type_=type_,
            config=config,
            workflow_id=workflow_id,
        )

        replace_agent_body.additional_properties = d
        return replace_agent_body

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
