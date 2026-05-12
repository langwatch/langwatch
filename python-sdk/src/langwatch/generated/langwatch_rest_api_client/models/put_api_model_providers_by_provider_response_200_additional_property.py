from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_model_providers_by_provider_response_200_additional_property_custom_embeddings_models_type_0_item import (
        PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomEmbeddingsModelsType0Item,
    )
    from ..models.put_api_model_providers_by_provider_response_200_additional_property_custom_keys_type_0 import (
        PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0,
    )
    from ..models.put_api_model_providers_by_provider_response_200_additional_property_custom_models_type_0_item import (
        PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomModelsType0Item,
    )
    from ..models.put_api_model_providers_by_provider_response_200_additional_property_extra_headers_type_0_item import (
        PutApiModelProvidersByProviderResponse200AdditionalPropertyExtraHeadersType0Item,
    )


T = TypeVar("T", bound="PutApiModelProvidersByProviderResponse200AdditionalProperty")


@_attrs_define
class PutApiModelProvidersByProviderResponse200AdditionalProperty:
    """
    Attributes:
        provider (str):
        enabled (bool):
        custom_keys (None | PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0):
        id (str | Unset):
        deployment_mapping (None | Unset):
        models (list[str] | None | Unset):
        embeddings_models (list[str] | None | Unset):
        custom_models (list[PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomModelsType0Item] | None |
            Unset):
        custom_embeddings_models
            (list[PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomEmbeddingsModelsType0Item] | None |
            Unset):
        disabled_by_default (bool | Unset):
        extra_headers (list[PutApiModelProvidersByProviderResponse200AdditionalPropertyExtraHeadersType0Item] | None |
            Unset):
    """

    provider: str
    enabled: bool
    custom_keys: None | PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0
    id: str | Unset = UNSET
    deployment_mapping: None | Unset = UNSET
    models: list[str] | None | Unset = UNSET
    embeddings_models: list[str] | None | Unset = UNSET
    custom_models: (
        list[PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomModelsType0Item] | None | Unset
    ) = UNSET
    custom_embeddings_models: (
        list[PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomEmbeddingsModelsType0Item] | None | Unset
    ) = UNSET
    disabled_by_default: bool | Unset = UNSET
    extra_headers: (
        list[PutApiModelProvidersByProviderResponse200AdditionalPropertyExtraHeadersType0Item] | None | Unset
    ) = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.put_api_model_providers_by_provider_response_200_additional_property_custom_keys_type_0 import (
            PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0,
        )

        provider = self.provider

        enabled = self.enabled

        custom_keys: dict[str, Any] | None
        if isinstance(self.custom_keys, PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0):
            custom_keys = self.custom_keys.to_dict()
        else:
            custom_keys = self.custom_keys

        id = self.id

        deployment_mapping = self.deployment_mapping

        models: list[str] | None | Unset
        if isinstance(self.models, Unset):
            models = UNSET
        elif isinstance(self.models, list):
            models = self.models

        else:
            models = self.models

        embeddings_models: list[str] | None | Unset
        if isinstance(self.embeddings_models, Unset):
            embeddings_models = UNSET
        elif isinstance(self.embeddings_models, list):
            embeddings_models = self.embeddings_models

        else:
            embeddings_models = self.embeddings_models

        custom_models: list[dict[str, Any]] | None | Unset
        if isinstance(self.custom_models, Unset):
            custom_models = UNSET
        elif isinstance(self.custom_models, list):
            custom_models = []
            for custom_models_type_0_item_data in self.custom_models:
                custom_models_type_0_item = custom_models_type_0_item_data.to_dict()
                custom_models.append(custom_models_type_0_item)

        else:
            custom_models = self.custom_models

        custom_embeddings_models: list[dict[str, Any]] | None | Unset
        if isinstance(self.custom_embeddings_models, Unset):
            custom_embeddings_models = UNSET
        elif isinstance(self.custom_embeddings_models, list):
            custom_embeddings_models = []
            for custom_embeddings_models_type_0_item_data in self.custom_embeddings_models:
                custom_embeddings_models_type_0_item = custom_embeddings_models_type_0_item_data.to_dict()
                custom_embeddings_models.append(custom_embeddings_models_type_0_item)

        else:
            custom_embeddings_models = self.custom_embeddings_models

        disabled_by_default = self.disabled_by_default

        extra_headers: list[dict[str, Any]] | None | Unset
        if isinstance(self.extra_headers, Unset):
            extra_headers = UNSET
        elif isinstance(self.extra_headers, list):
            extra_headers = []
            for extra_headers_type_0_item_data in self.extra_headers:
                extra_headers_type_0_item = extra_headers_type_0_item_data.to_dict()
                extra_headers.append(extra_headers_type_0_item)

        else:
            extra_headers = self.extra_headers

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "provider": provider,
                "enabled": enabled,
                "customKeys": custom_keys,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if deployment_mapping is not UNSET:
            field_dict["deploymentMapping"] = deployment_mapping
        if models is not UNSET:
            field_dict["models"] = models
        if embeddings_models is not UNSET:
            field_dict["embeddingsModels"] = embeddings_models
        if custom_models is not UNSET:
            field_dict["customModels"] = custom_models
        if custom_embeddings_models is not UNSET:
            field_dict["customEmbeddingsModels"] = custom_embeddings_models
        if disabled_by_default is not UNSET:
            field_dict["disabledByDefault"] = disabled_by_default
        if extra_headers is not UNSET:
            field_dict["extraHeaders"] = extra_headers

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_model_providers_by_provider_response_200_additional_property_custom_embeddings_models_type_0_item import (
            PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomEmbeddingsModelsType0Item,
        )
        from ..models.put_api_model_providers_by_provider_response_200_additional_property_custom_keys_type_0 import (
            PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0,
        )
        from ..models.put_api_model_providers_by_provider_response_200_additional_property_custom_models_type_0_item import (
            PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomModelsType0Item,
        )
        from ..models.put_api_model_providers_by_provider_response_200_additional_property_extra_headers_type_0_item import (
            PutApiModelProvidersByProviderResponse200AdditionalPropertyExtraHeadersType0Item,
        )

        d = dict(src_dict)
        provider = d.pop("provider")

        enabled = d.pop("enabled")

        def _parse_custom_keys(
            data: object,
        ) -> None | PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                custom_keys_type_0 = (
                    PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0.from_dict(data)
                )

                return custom_keys_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomKeysType0, data)

        custom_keys = _parse_custom_keys(d.pop("customKeys"))

        id = d.pop("id", UNSET)

        deployment_mapping = d.pop("deploymentMapping", UNSET)

        def _parse_models(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                models_type_0 = cast(list[str], data)

                return models_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        models = _parse_models(d.pop("models", UNSET))

        def _parse_embeddings_models(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                embeddings_models_type_0 = cast(list[str], data)

                return embeddings_models_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        embeddings_models = _parse_embeddings_models(d.pop("embeddingsModels", UNSET))

        def _parse_custom_models(
            data: object,
        ) -> list[PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomModelsType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                custom_models_type_0 = []
                _custom_models_type_0 = data
                for custom_models_type_0_item_data in _custom_models_type_0:
                    custom_models_type_0_item = (
                        PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomModelsType0Item.from_dict(
                            custom_models_type_0_item_data
                        )
                    )

                    custom_models_type_0.append(custom_models_type_0_item)

                return custom_models_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                list[PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomModelsType0Item] | None | Unset,
                data,
            )

        custom_models = _parse_custom_models(d.pop("customModels", UNSET))

        def _parse_custom_embeddings_models(
            data: object,
        ) -> (
            list[PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomEmbeddingsModelsType0Item]
            | None
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                custom_embeddings_models_type_0 = []
                _custom_embeddings_models_type_0 = data
                for custom_embeddings_models_type_0_item_data in _custom_embeddings_models_type_0:
                    custom_embeddings_models_type_0_item = PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomEmbeddingsModelsType0Item.from_dict(
                        custom_embeddings_models_type_0_item_data
                    )

                    custom_embeddings_models_type_0.append(custom_embeddings_models_type_0_item)

                return custom_embeddings_models_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                list[PutApiModelProvidersByProviderResponse200AdditionalPropertyCustomEmbeddingsModelsType0Item]
                | None
                | Unset,
                data,
            )

        custom_embeddings_models = _parse_custom_embeddings_models(d.pop("customEmbeddingsModels", UNSET))

        disabled_by_default = d.pop("disabledByDefault", UNSET)

        def _parse_extra_headers(
            data: object,
        ) -> list[PutApiModelProvidersByProviderResponse200AdditionalPropertyExtraHeadersType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                extra_headers_type_0 = []
                _extra_headers_type_0 = data
                for extra_headers_type_0_item_data in _extra_headers_type_0:
                    extra_headers_type_0_item = (
                        PutApiModelProvidersByProviderResponse200AdditionalPropertyExtraHeadersType0Item.from_dict(
                            extra_headers_type_0_item_data
                        )
                    )

                    extra_headers_type_0.append(extra_headers_type_0_item)

                return extra_headers_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                list[PutApiModelProvidersByProviderResponse200AdditionalPropertyExtraHeadersType0Item] | None | Unset,
                data,
            )

        extra_headers = _parse_extra_headers(d.pop("extraHeaders", UNSET))

        put_api_model_providers_by_provider_response_200_additional_property = cls(
            provider=provider,
            enabled=enabled,
            custom_keys=custom_keys,
            id=id,
            deployment_mapping=deployment_mapping,
            models=models,
            embeddings_models=embeddings_models,
            custom_models=custom_models,
            custom_embeddings_models=custom_embeddings_models,
            disabled_by_default=disabled_by_default,
            extra_headers=extra_headers,
        )

        put_api_model_providers_by_provider_response_200_additional_property.additional_properties = d
        return put_api_model_providers_by_provider_response_200_additional_property

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
