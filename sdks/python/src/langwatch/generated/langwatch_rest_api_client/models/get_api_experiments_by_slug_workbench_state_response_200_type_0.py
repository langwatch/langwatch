from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_experiments_by_slug_workbench_state_response_200_type_0_state_type_0 import (
        GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0,
    )


T = TypeVar("T", bound="GetApiExperimentsBySlugWorkbenchStateResponse200Type0")


@_attrs_define
class GetApiExperimentsBySlugWorkbenchStateResponse200Type0:
    """
    Attributes:
        id (str):
        slug (str):
        name (None | str):
        state (GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0 | None): The experiment setup: datasets,
            targets and evaluators. Read it, change it, send it back whole.
        version (int): Send this back as expectedVersion to save safely
        updated_at (str): ISO 8601 timestamp of the last save
    """

    id: str
    slug: str
    name: None | str
    state: GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0 | None
    version: int
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_experiments_by_slug_workbench_state_response_200_type_0_state_type_0 import (
            GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0,
        )

        id = self.id

        slug = self.slug

        name: None | str
        name = self.name

        state: dict[str, Any] | None
        if isinstance(self.state, GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0):
            state = self.state.to_dict()
        else:
            state = self.state

        version = self.version

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "state": state,
                "version": version,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_by_slug_workbench_state_response_200_type_0_state_type_0 import (
            GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        def _parse_state(data: object) -> GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                state_type_0 = GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0.from_dict(data)

                return state_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiExperimentsBySlugWorkbenchStateResponse200Type0StateType0 | None, data)

        state = _parse_state(d.pop("state"))

        version = d.pop("version")

        updated_at = d.pop("updatedAt")

        get_api_experiments_by_slug_workbench_state_response_200_type_0 = cls(
            id=id,
            slug=slug,
            name=name,
            state=state,
            version=version,
            updated_at=updated_at,
        )

        get_api_experiments_by_slug_workbench_state_response_200_type_0.additional_properties = d
        return get_api_experiments_by_slug_workbench_state_response_200_type_0

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
