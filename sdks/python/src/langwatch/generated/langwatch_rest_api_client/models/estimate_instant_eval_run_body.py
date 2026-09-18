from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.estimate_instant_eval_run_body_parameters import EstimateInstantEvalRunBodyParameters


T = TypeVar("T", bound="EstimateInstantEvalRunBody")


@_attrs_define
class EstimateInstantEvalRunBody:
    """
    Attributes:
        sql (str): The LangWatchQL statement to judge. It must project TraceId and at least one eval function column.
        parameters (EstimateInstantEvalRunBodyParameters | Unset): Values for the parameters the statement declares.
        name (str | Unset): What to call the run. Yours to choose.
        limit (int | Unset): Rows the run may judge. Ten thousand by default on every plan, up to one hundred thousand
            on a plan that lifts the cap.
    """

    sql: str
    parameters: EstimateInstantEvalRunBodyParameters | Unset = UNSET
    name: str | Unset = UNSET
    limit: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sql = self.sql

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        name = self.name

        limit = self.limit

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sql": sql,
            }
        )
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if name is not UNSET:
            field_dict["name"] = name
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.estimate_instant_eval_run_body_parameters import EstimateInstantEvalRunBodyParameters

        d = dict(src_dict)
        sql = d.pop("sql")

        _parameters = d.pop("parameters", UNSET)
        parameters: EstimateInstantEvalRunBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = EstimateInstantEvalRunBodyParameters.from_dict(_parameters)

        name = d.pop("name", UNSET)

        limit = d.pop("limit", UNSET)

        estimate_instant_eval_run_body = cls(
            sql=sql,
            parameters=parameters,
            name=name,
            limit=limit,
        )

        estimate_instant_eval_run_body.additional_properties = d
        return estimate_instant_eval_run_body

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
