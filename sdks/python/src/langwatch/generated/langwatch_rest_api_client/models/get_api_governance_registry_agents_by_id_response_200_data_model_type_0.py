from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_agents_by_id_response_200_data_model_type_0_parameters import (
        GetApiGovernanceRegistryAgentsByIdResponse200DataModelType0Parameters,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistryAgentsByIdResponse200DataModelType0")


@_attrs_define
class GetApiGovernanceRegistryAgentsByIdResponse200DataModelType0:
    """
    Attributes:
        provider (None | str):
        model (str):
        parameters (GetApiGovernanceRegistryAgentsByIdResponse200DataModelType0Parameters):
    """

    provider: None | str
    model: str
    parameters: GetApiGovernanceRegistryAgentsByIdResponse200DataModelType0Parameters

    def to_dict(self) -> dict[str, Any]:
        provider: None | str
        provider = self.provider

        model = self.model

        parameters = self.parameters.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "provider": provider,
                "model": model,
                "parameters": parameters,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_registry_agents_by_id_response_200_data_model_type_0_parameters import (
            GetApiGovernanceRegistryAgentsByIdResponse200DataModelType0Parameters,
        )

        d = dict(src_dict)

        def _parse_provider(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider = _parse_provider(d.pop("provider"))

        model = d.pop("model")

        parameters = GetApiGovernanceRegistryAgentsByIdResponse200DataModelType0Parameters.from_dict(
            d.pop("parameters")
        )

        get_api_governance_registry_agents_by_id_response_200_data_model_type_0 = cls(
            provider=provider,
            model=model,
            parameters=parameters,
        )

        return get_api_governance_registry_agents_by_id_response_200_data_model_type_0
