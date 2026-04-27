from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.put_api_model_providers_by_provider_body_custom_models_type_0_item_mode import (
    PutApiModelProvidersByProviderBodyCustomModelsType0ItemMode,
)
from ..models.put_api_model_providers_by_provider_body_custom_models_type_0_item_multimodal_inputs_item import (
    PutApiModelProvidersByProviderBodyCustomModelsType0ItemMultimodalInputsItem,
)
from ..models.put_api_model_providers_by_provider_body_custom_models_type_0_item_supported_parameters_item import (
    PutApiModelProvidersByProviderBodyCustomModelsType0ItemSupportedParametersItem,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PutApiModelProvidersByProviderBodyCustomModelsType0Item")


@_attrs_define
class PutApiModelProvidersByProviderBodyCustomModelsType0Item:
    """
    Attributes:
        model_id (str):
        display_name (str):
        mode (PutApiModelProvidersByProviderBodyCustomModelsType0ItemMode):
        max_tokens (float | None | Unset):
        supported_parameters (list[PutApiModelProvidersByProviderBodyCustomModelsType0ItemSupportedParametersItem] |
            Unset):
        multimodal_inputs (list[PutApiModelProvidersByProviderBodyCustomModelsType0ItemMultimodalInputsItem] | Unset):
    """

    model_id: str
    display_name: str
    mode: PutApiModelProvidersByProviderBodyCustomModelsType0ItemMode
    max_tokens: float | None | Unset = UNSET
    supported_parameters: (
        list[PutApiModelProvidersByProviderBodyCustomModelsType0ItemSupportedParametersItem] | Unset
    ) = UNSET
    multimodal_inputs: list[PutApiModelProvidersByProviderBodyCustomModelsType0ItemMultimodalInputsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        model_id = self.model_id

        display_name = self.display_name

        mode = self.mode.value

        max_tokens: float | None | Unset
        if isinstance(self.max_tokens, Unset):
            max_tokens = UNSET
        else:
            max_tokens = self.max_tokens

        supported_parameters: list[str] | Unset = UNSET
        if not isinstance(self.supported_parameters, Unset):
            supported_parameters = []
            for supported_parameters_item_data in self.supported_parameters:
                supported_parameters_item = supported_parameters_item_data.value
                supported_parameters.append(supported_parameters_item)

        multimodal_inputs: list[str] | Unset = UNSET
        if not isinstance(self.multimodal_inputs, Unset):
            multimodal_inputs = []
            for multimodal_inputs_item_data in self.multimodal_inputs:
                multimodal_inputs_item = multimodal_inputs_item_data.value
                multimodal_inputs.append(multimodal_inputs_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "modelId": model_id,
                "displayName": display_name,
                "mode": mode,
            }
        )
        if max_tokens is not UNSET:
            field_dict["maxTokens"] = max_tokens
        if supported_parameters is not UNSET:
            field_dict["supportedParameters"] = supported_parameters
        if multimodal_inputs is not UNSET:
            field_dict["multimodalInputs"] = multimodal_inputs

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        model_id = d.pop("modelId")

        display_name = d.pop("displayName")

        mode = PutApiModelProvidersByProviderBodyCustomModelsType0ItemMode(d.pop("mode"))

        def _parse_max_tokens(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        max_tokens = _parse_max_tokens(d.pop("maxTokens", UNSET))

        _supported_parameters = d.pop("supportedParameters", UNSET)
        supported_parameters: (
            list[PutApiModelProvidersByProviderBodyCustomModelsType0ItemSupportedParametersItem] | Unset
        ) = UNSET
        if _supported_parameters is not UNSET:
            supported_parameters = []
            for supported_parameters_item_data in _supported_parameters:
                supported_parameters_item = (
                    PutApiModelProvidersByProviderBodyCustomModelsType0ItemSupportedParametersItem(
                        supported_parameters_item_data
                    )
                )

                supported_parameters.append(supported_parameters_item)

        _multimodal_inputs = d.pop("multimodalInputs", UNSET)
        multimodal_inputs: list[PutApiModelProvidersByProviderBodyCustomModelsType0ItemMultimodalInputsItem] | Unset = (
            UNSET
        )
        if _multimodal_inputs is not UNSET:
            multimodal_inputs = []
            for multimodal_inputs_item_data in _multimodal_inputs:
                multimodal_inputs_item = PutApiModelProvidersByProviderBodyCustomModelsType0ItemMultimodalInputsItem(
                    multimodal_inputs_item_data
                )

                multimodal_inputs.append(multimodal_inputs_item)

        put_api_model_providers_by_provider_body_custom_models_type_0_item = cls(
            model_id=model_id,
            display_name=display_name,
            mode=mode,
            max_tokens=max_tokens,
            supported_parameters=supported_parameters,
            multimodal_inputs=multimodal_inputs,
        )

        put_api_model_providers_by_provider_body_custom_models_type_0_item.additional_properties = d
        return put_api_model_providers_by_provider_body_custom_models_type_0_item

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
