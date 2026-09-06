from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_model_providers_by_provider_body_custom_embeddings_models_type_0_item import (
        PutApiModelProvidersByProviderBodyCustomEmbeddingsModelsType0Item,
    )
    from ..models.put_api_model_providers_by_provider_body_custom_keys import (
        PutApiModelProvidersByProviderBodyCustomKeys,
    )
    from ..models.put_api_model_providers_by_provider_body_custom_models_type_0_item import (
        PutApiModelProvidersByProviderBodyCustomModelsType0Item,
    )
    from ..models.put_api_model_providers_by_provider_body_extra_headers_item import (
        PutApiModelProvidersByProviderBodyExtraHeadersItem,
    )


T = TypeVar("T", bound="PutApiModelProvidersByProviderBody")


@_attrs_define
class PutApiModelProvidersByProviderBody:
    """
    Attributes:
        enabled (bool):
        custom_keys (PutApiModelProvidersByProviderBodyCustomKeys | Unset):
        custom_models (list[PutApiModelProvidersByProviderBodyCustomModelsType0Item] | list[str] | Unset):
        custom_embeddings_models (list[PutApiModelProvidersByProviderBodyCustomEmbeddingsModelsType0Item] | list[str] |
            Unset):
        extra_headers (list[PutApiModelProvidersByProviderBodyExtraHeadersItem] | Unset):
        default_model (str | Unset):
    """

    enabled: bool
    custom_keys: PutApiModelProvidersByProviderBodyCustomKeys | Unset = UNSET
    custom_models: list[PutApiModelProvidersByProviderBodyCustomModelsType0Item] | list[str] | Unset = UNSET
    custom_embeddings_models: (
        list[PutApiModelProvidersByProviderBodyCustomEmbeddingsModelsType0Item] | list[str] | Unset
    ) = UNSET
    extra_headers: list[PutApiModelProvidersByProviderBodyExtraHeadersItem] | Unset = UNSET
    default_model: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        custom_keys: dict[str, Any] | Unset = UNSET
        if not isinstance(self.custom_keys, Unset):
            custom_keys = self.custom_keys.to_dict()

        custom_models: list[dict[str, Any]] | list[str] | Unset
        if isinstance(self.custom_models, Unset):
            custom_models = UNSET
        elif isinstance(self.custom_models, list):
            custom_models = []
            for custom_models_type_0_item_data in self.custom_models:
                custom_models_type_0_item = custom_models_type_0_item_data.to_dict()
                custom_models.append(custom_models_type_0_item)

        else:
            custom_models = self.custom_models

        custom_embeddings_models: list[dict[str, Any]] | list[str] | Unset
        if isinstance(self.custom_embeddings_models, Unset):
            custom_embeddings_models = UNSET
        elif isinstance(self.custom_embeddings_models, list):
            custom_embeddings_models = []
            for custom_embeddings_models_type_0_item_data in self.custom_embeddings_models:
                custom_embeddings_models_type_0_item = custom_embeddings_models_type_0_item_data.to_dict()
                custom_embeddings_models.append(custom_embeddings_models_type_0_item)

        else:
            custom_embeddings_models = self.custom_embeddings_models

        extra_headers: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.extra_headers, Unset):
            extra_headers = []
            for extra_headers_item_data in self.extra_headers:
                extra_headers_item = extra_headers_item_data.to_dict()
                extra_headers.append(extra_headers_item)

        default_model = self.default_model

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "enabled": enabled,
            }
        )
        if custom_keys is not UNSET:
            field_dict["customKeys"] = custom_keys
        if custom_models is not UNSET:
            field_dict["customModels"] = custom_models
        if custom_embeddings_models is not UNSET:
            field_dict["customEmbeddingsModels"] = custom_embeddings_models
        if extra_headers is not UNSET:
            field_dict["extraHeaders"] = extra_headers
        if default_model is not UNSET:
            field_dict["defaultModel"] = default_model

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_model_providers_by_provider_body_custom_embeddings_models_type_0_item import (
            PutApiModelProvidersByProviderBodyCustomEmbeddingsModelsType0Item,
        )
        from ..models.put_api_model_providers_by_provider_body_custom_keys import (
            PutApiModelProvidersByProviderBodyCustomKeys,
        )
        from ..models.put_api_model_providers_by_provider_body_custom_models_type_0_item import (
            PutApiModelProvidersByProviderBodyCustomModelsType0Item,
        )
        from ..models.put_api_model_providers_by_provider_body_extra_headers_item import (
            PutApiModelProvidersByProviderBodyExtraHeadersItem,
        )

        d = dict(src_dict)
        enabled = d.pop("enabled")

        _custom_keys = d.pop("customKeys", UNSET)
        custom_keys: PutApiModelProvidersByProviderBodyCustomKeys | Unset
        if isinstance(_custom_keys, Unset):
            custom_keys = UNSET
        else:
            custom_keys = PutApiModelProvidersByProviderBodyCustomKeys.from_dict(_custom_keys)

        def _parse_custom_models(
            data: object,
        ) -> list[PutApiModelProvidersByProviderBodyCustomModelsType0Item] | list[str] | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                custom_models_type_0 = []
                _custom_models_type_0 = data
                for custom_models_type_0_item_data in _custom_models_type_0:
                    custom_models_type_0_item = PutApiModelProvidersByProviderBodyCustomModelsType0Item.from_dict(
                        custom_models_type_0_item_data
                    )

                    custom_models_type_0.append(custom_models_type_0_item)

                return custom_models_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            custom_models_type_1 = cast(list[str], data)

            return custom_models_type_1

        custom_models = _parse_custom_models(d.pop("customModels", UNSET))

        def _parse_custom_embeddings_models(
            data: object,
        ) -> list[PutApiModelProvidersByProviderBodyCustomEmbeddingsModelsType0Item] | list[str] | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                custom_embeddings_models_type_0 = []
                _custom_embeddings_models_type_0 = data
                for custom_embeddings_models_type_0_item_data in _custom_embeddings_models_type_0:
                    custom_embeddings_models_type_0_item = (
                        PutApiModelProvidersByProviderBodyCustomEmbeddingsModelsType0Item.from_dict(
                            custom_embeddings_models_type_0_item_data
                        )
                    )

                    custom_embeddings_models_type_0.append(custom_embeddings_models_type_0_item)

                return custom_embeddings_models_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            custom_embeddings_models_type_1 = cast(list[str], data)

            return custom_embeddings_models_type_1

        custom_embeddings_models = _parse_custom_embeddings_models(d.pop("customEmbeddingsModels", UNSET))

        _extra_headers = d.pop("extraHeaders", UNSET)
        extra_headers: list[PutApiModelProvidersByProviderBodyExtraHeadersItem] | Unset = UNSET
        if _extra_headers is not UNSET:
            extra_headers = []
            for extra_headers_item_data in _extra_headers:
                extra_headers_item = PutApiModelProvidersByProviderBodyExtraHeadersItem.from_dict(
                    extra_headers_item_data
                )

                extra_headers.append(extra_headers_item)

        default_model = d.pop("defaultModel", UNSET)

        put_api_model_providers_by_provider_body = cls(
            enabled=enabled,
            custom_keys=custom_keys,
            custom_models=custom_models,
            custom_embeddings_models=custom_embeddings_models,
            extra_headers=extra_headers,
            default_model=default_model,
        )

        put_api_model_providers_by_provider_body.additional_properties = d
        return put_api_model_providers_by_provider_body

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
