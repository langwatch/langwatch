from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_governance_registry_events_response_200_data_item_agent_tools_item_status import (
    GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemStatus,
)

if TYPE_CHECKING:
    from ..models.get_api_governance_registry_events_response_200_data_item_agent_tools_item_input_schema import (
        GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemInputSchema,
    )
    from ..models.get_api_governance_registry_events_response_200_data_item_agent_tools_item_output_schema_type_0 import (
        GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0,
    )


T = TypeVar("T", bound="GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItem")


@_attrs_define
class GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItem:
    """
    Attributes:
        name (str):
        description (None | str):
        input_schema (GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemInputSchema):
        output_schema (GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0 | None):
        status (GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemStatus):
        deprecated_in_version (int | None):
        deprecated_at (None | str):
    """

    name: str
    description: None | str
    input_schema: GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemInputSchema
    output_schema: GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0 | None
    status: GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemStatus
    deprecated_in_version: int | None
    deprecated_at: None | str

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_governance_registry_events_response_200_data_item_agent_tools_item_output_schema_type_0 import (
            GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0,
        )

        name = self.name

        description: None | str
        description = self.description

        input_schema = self.input_schema.to_dict()

        output_schema: dict[str, Any] | None
        if isinstance(
            self.output_schema, GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0
        ):
            output_schema = self.output_schema.to_dict()
        else:
            output_schema = self.output_schema

        status = self.status.value

        deprecated_in_version: int | None
        deprecated_in_version = self.deprecated_in_version

        deprecated_at: None | str
        deprecated_at = self.deprecated_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "description": description,
                "input_schema": input_schema,
                "output_schema": output_schema,
                "status": status,
                "deprecated_in_version": deprecated_in_version,
                "deprecated_at": deprecated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_governance_registry_events_response_200_data_item_agent_tools_item_input_schema import (
            GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemInputSchema,
        )
        from ..models.get_api_governance_registry_events_response_200_data_item_agent_tools_item_output_schema_type_0 import (
            GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0,
        )

        d = dict(src_dict)
        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        input_schema = GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemInputSchema.from_dict(
            d.pop("input_schema")
        )

        def _parse_output_schema(
            data: object,
        ) -> GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                output_schema_type_0 = (
                    GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0.from_dict(data)
                )

                return output_schema_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemOutputSchemaType0 | None, data)

        output_schema = _parse_output_schema(d.pop("output_schema"))

        status = GetApiGovernanceRegistryEventsResponse200DataItemAgentToolsItemStatus(d.pop("status"))

        def _parse_deprecated_in_version(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        deprecated_in_version = _parse_deprecated_in_version(d.pop("deprecated_in_version"))

        def _parse_deprecated_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        deprecated_at = _parse_deprecated_at(d.pop("deprecated_at"))

        get_api_governance_registry_events_response_200_data_item_agent_tools_item = cls(
            name=name,
            description=description,
            input_schema=input_schema,
            output_schema=output_schema,
            status=status,
            deprecated_in_version=deprecated_in_version,
            deprecated_at=deprecated_at,
        )

        return get_api_governance_registry_events_response_200_data_item_agent_tools_item
