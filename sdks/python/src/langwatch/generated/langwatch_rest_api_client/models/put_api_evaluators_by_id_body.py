from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_evaluators_by_id_body_config import PutApiEvaluatorsByIdBodyConfig


T = TypeVar("T", bound="PutApiEvaluatorsByIdBody")


@_attrs_define
class PutApiEvaluatorsByIdBody:
    """
    Attributes:
        name (str | Unset):
        config (PutApiEvaluatorsByIdBodyConfig | Unset):
    """

    name: str | Unset = UNSET
    config: PutApiEvaluatorsByIdBodyConfig | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.config, Unset):
            config = self.config.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if config is not UNSET:
            field_dict["config"] = config

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_evaluators_by_id_body_config import PutApiEvaluatorsByIdBodyConfig

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _config = d.pop("config", UNSET)
        config: PutApiEvaluatorsByIdBodyConfig | Unset
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = PutApiEvaluatorsByIdBodyConfig.from_dict(_config)

        put_api_evaluators_by_id_body = cls(
            name=name,
            config=config,
        )

        put_api_evaluators_by_id_body.additional_properties = d
        return put_api_evaluators_by_id_body

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
