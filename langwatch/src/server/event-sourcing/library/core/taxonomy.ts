export type ProvenanceLangWatch = "lw";
export type Provenance = ProvenanceLangWatch;

export type DomainObservability = "obs";
export type Domain = DomainObservability;

export type EntitySpan = "span";
export type EntityTrace = "trace";
export type Entity = EntitySpan | EntityTrace;

export type LwObsEntitySpan =
  `${ProvenanceLangWatch}.${DomainObservability}.${EntitySpan}`;
export type LwObsEntityTrace =
  `${ProvenanceLangWatch}.${DomainObservability}.${EntityTrace}`;
