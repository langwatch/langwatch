from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_experiments_by_slug_workbench_state_response_200_state_type_0 import (
        GetApiExperimentsBySlugWorkbenchStateResponse200StateType0,
    )


T = TypeVar("T", bound="GetApiExperimentsBySlugWorkbenchStateResponse200")


@_attrs_define
class GetApiExperimentsBySlugWorkbenchStateResponse200:
    """
    Attributes:
        id (str):
        slug (str):
        version (int): Send this back as expectedVersion to save safely
        updated_at (str): ISO 8601 timestamp of the last save
        name (None | str | Unset):
        state (GetApiExperimentsBySlugWorkbenchStateResponse200StateType0 | None | Unset):
    """

    id: str
    slug: str
    version: int
    updated_at: str
    name: None | str | Unset = UNSET
    state: GetApiExperimentsBySlugWorkbenchStateResponse200StateType0 | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_experiments_by_slug_workbench_state_response_200_state_type_0 import (
            GetApiExperimentsBySlugWorkbenchStateResponse200StateType0,
        )

        id = self.id

        slug = self.slug

        version = self.version

        updated_at = self.updated_at

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

        state: dict[str, Any] | None | Unset
        if isinstance(self.state, Unset):
            state = UNSET
        elif isinstance(self.state, GetApiExperimentsBySlugWorkbenchStateResponse200StateType0):
            state = self.state.to_dict()
        else:
            state = self.state

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "version": version,
                "updatedAt": updated_at,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name
        if state is not UNSET:
            field_dict["state"] = state

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_experiments_by_slug_workbench_state_response_200_state_type_0 import (
            GetApiExperimentsBySlugWorkbenchStateResponse200StateType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        slug = d.pop("slug")

        version = d.pop("version")

        updated_at = d.pop("updatedAt")

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        def _parse_state(data: object) -> GetApiExperimentsBySlugWorkbenchStateResponse200StateType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                state_type_0 = GetApiExperimentsBySlugWorkbenchStateResponse200StateType0.from_dict(data)

                return state_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiExperimentsBySlugWorkbenchStateResponse200StateType0 | None | Unset, data)

        state = _parse_state(d.pop("state", UNSET))

        get_api_experiments_by_slug_workbench_state_response_200 = cls(
            id=id,
            slug=slug,
            version=version,
            updated_at=updated_at,
            name=name,
            state=state,
        )

        return get_api_experiments_by_slug_workbench_state_response_200
