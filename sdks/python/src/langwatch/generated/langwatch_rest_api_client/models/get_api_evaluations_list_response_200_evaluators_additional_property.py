from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_evaluations_list_response_200_evaluators_additional_property_result import (
        GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertyResult,
    )
    from ..models.get_api_evaluations_list_response_200_evaluators_additional_property_settings import (
        GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettings,
    )
    from ..models.get_api_evaluations_list_response_200_evaluators_additional_property_settings_json_schema import (
        GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettingsJsonSchema,
    )


T = TypeVar("T", bound="GetApiEvaluationsListResponse200EvaluatorsAdditionalProperty")


@_attrs_define
class GetApiEvaluationsListResponse200EvaluatorsAdditionalProperty:
    """
    Attributes:
        name (str): Display name of the evaluator
        description (str):
        category (str):
        is_guardrail (bool): Whether this evaluator can gate a request as a guardrail
        required_fields (list[str]): `data` keys the evaluate call must supply
        optional_fields (list[str]):
        settings (GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettings): Each setting's default and
            description
        settings_json_schema (GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettingsJsonSchema): JSON
            Schema for this evaluator's settings object
        env_vars (list[str]): Server-side variables the evaluator needs configured
        result (GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertyResult): What its score, passed and label
            mean
        docs_url (str | Unset):
    """

    name: str
    description: str
    category: str
    is_guardrail: bool
    required_fields: list[str]
    optional_fields: list[str]
    settings: GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettings
    settings_json_schema: GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettingsJsonSchema
    env_vars: list[str]
    result: GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertyResult
    docs_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        category = self.category

        is_guardrail = self.is_guardrail

        required_fields = self.required_fields

        optional_fields = self.optional_fields

        settings = self.settings.to_dict()

        settings_json_schema = self.settings_json_schema.to_dict()

        env_vars = self.env_vars

        result = self.result.to_dict()

        docs_url = self.docs_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "description": description,
                "category": category,
                "isGuardrail": is_guardrail,
                "requiredFields": required_fields,
                "optionalFields": optional_fields,
                "settings": settings,
                "settings_json_schema": settings_json_schema,
                "envVars": env_vars,
                "result": result,
            }
        )
        if docs_url is not UNSET:
            field_dict["docsUrl"] = docs_url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_evaluations_list_response_200_evaluators_additional_property_result import (
            GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertyResult,
        )
        from ..models.get_api_evaluations_list_response_200_evaluators_additional_property_settings import (
            GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettings,
        )
        from ..models.get_api_evaluations_list_response_200_evaluators_additional_property_settings_json_schema import (
            GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettingsJsonSchema,
        )

        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description")

        category = d.pop("category")

        is_guardrail = d.pop("isGuardrail")

        required_fields = cast(list[str], d.pop("requiredFields"))

        optional_fields = cast(list[str], d.pop("optionalFields"))

        settings = GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettings.from_dict(d.pop("settings"))

        settings_json_schema = GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertySettingsJsonSchema.from_dict(
            d.pop("settings_json_schema")
        )

        env_vars = cast(list[str], d.pop("envVars"))

        result = GetApiEvaluationsListResponse200EvaluatorsAdditionalPropertyResult.from_dict(d.pop("result"))

        docs_url = d.pop("docsUrl", UNSET)

        get_api_evaluations_list_response_200_evaluators_additional_property = cls(
            name=name,
            description=description,
            category=category,
            is_guardrail=is_guardrail,
            required_fields=required_fields,
            optional_fields=optional_fields,
            settings=settings,
            settings_json_schema=settings_json_schema,
            env_vars=env_vars,
            result=result,
            docs_url=docs_url,
        )

        get_api_evaluations_list_response_200_evaluators_additional_property.additional_properties = d
        return get_api_evaluations_list_response_200_evaluators_additional_property

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
