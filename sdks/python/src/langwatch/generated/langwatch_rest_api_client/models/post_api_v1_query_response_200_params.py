from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_v1_query_response_200_params_parameters import PostApiV1QueryResponse200ParamsParameters
    from ..models.post_api_v1_query_response_200_params_period import PostApiV1QueryResponse200ParamsPeriod


T = TypeVar("T", bound="PostApiV1QueryResponse200Params")


@_attrs_define
class PostApiV1QueryResponse200Params:
    """
    Attributes:
        sources (list[str]):
        follows_sources (bool):
        projects (list[str]):
        parameters (PostApiV1QueryResponse200ParamsParameters):
        period (PostApiV1QueryResponse200ParamsPeriod | Unset):
        granularity_seconds (float | Unset):
        coarsened_from_seconds (float | Unset):
    """

    sources: list[str]
    follows_sources: bool
    projects: list[str]
    parameters: PostApiV1QueryResponse200ParamsParameters
    period: PostApiV1QueryResponse200ParamsPeriod | Unset = UNSET
    granularity_seconds: float | Unset = UNSET
    coarsened_from_seconds: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        sources = self.sources

        follows_sources = self.follows_sources

        projects = self.projects

        parameters = self.parameters.to_dict()

        period: dict[str, Any] | Unset = UNSET
        if not isinstance(self.period, Unset):
            period = self.period.to_dict()

        granularity_seconds = self.granularity_seconds

        coarsened_from_seconds = self.coarsened_from_seconds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sources": sources,
                "followsSources": follows_sources,
                "projects": projects,
                "parameters": parameters,
            }
        )
        if period is not UNSET:
            field_dict["period"] = period
        if granularity_seconds is not UNSET:
            field_dict["granularitySeconds"] = granularity_seconds
        if coarsened_from_seconds is not UNSET:
            field_dict["coarsenedFromSeconds"] = coarsened_from_seconds

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_v1_query_response_200_params_parameters import PostApiV1QueryResponse200ParamsParameters
        from ..models.post_api_v1_query_response_200_params_period import PostApiV1QueryResponse200ParamsPeriod

        d = dict(src_dict)
        sources = cast(list[str], d.pop("sources"))

        follows_sources = d.pop("followsSources")

        projects = cast(list[str], d.pop("projects"))

        parameters = PostApiV1QueryResponse200ParamsParameters.from_dict(d.pop("parameters"))

        _period = d.pop("period", UNSET)
        period: PostApiV1QueryResponse200ParamsPeriod | Unset
        if isinstance(_period, Unset):
            period = UNSET
        else:
            period = PostApiV1QueryResponse200ParamsPeriod.from_dict(_period)

        granularity_seconds = d.pop("granularitySeconds", UNSET)

        coarsened_from_seconds = d.pop("coarsenedFromSeconds", UNSET)

        post_api_v1_query_response_200_params = cls(
            sources=sources,
            follows_sources=follows_sources,
            projects=projects,
            parameters=parameters,
            period=period,
            granularity_seconds=granularity_seconds,
            coarsened_from_seconds=coarsened_from_seconds,
        )

        return post_api_v1_query_response_200_params
