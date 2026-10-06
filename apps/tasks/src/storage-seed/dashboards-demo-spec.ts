/**
 * The shape of one dashboards demo project: the prototype's ProjectSpec,
 * trimmed to what the traffic generator reads, with the archetype defaults
 * already resolved. Pure types, so the generator and its tests need nothing else.
 */

export type DashboardsDemoArchetype =
  | "support-bot"
  | "rag"
  | "vendor"
  | "voice"
  | "extraction"
  | "regulated"
  | "tools-agent"
  | "generative";

/** How a conversation ended, as the outcome judge labels it. */
export type DashboardsDemoOutcome =
  | "resolved"
  | "misunderstood"
  | "capability_gap"
  | "refusal"
  | "handover";

export type DashboardsDemoGenerativeAction = "accepted" | "edited" | "regenerated" | "dropped";

type Weighted = [string, number];
type Preview = [string, string];

/** Trace fields a widget can depend on; each is the share of traces carrying it, 0..1. */
export type DashboardsDemoCoverage = Partial<
  Record<
    | "cost"
    | "model"
    | "user_id"
    | "thread_id"
    | "customer_id"
    | "labels"
    | "prompt_id"
    | "outcome"
    | "feedback"
    | "guardrail"
    | "language"
    | "ttft",
    number
  >
>;

export interface DashboardsDemoEvaluator {
  id: string;
  name: string;
  /** Share of traces it judges. */
  sampleRate: number;
  /** Typical share of judged traces that pass. */
  passRate: number;
  threshold?: number;
  kind?: "judge" | "check" | "guardrail";
  labels?: Weighted[];
}

export interface DashboardsDemoGuardrail {
  id: string;
  name: string;
  coverage: number;
  blockRate: number;
  flagRate: number;
}

/** What a dated change does to the traffic from its day on (the prototype's ChangeEffect). */
export interface DashboardsDemoEffect {
  outcome?: Partial<Record<DashboardsDemoOutcome, number>>;
  failureReasons?: Record<string, number>;
  evals?: Record<string, number>;
  segments?: Record<string, number>;
  tenants?: Record<string, number>;
  topics?: Record<string, number>;
  p95?: number;
  segmentLatency?: Record<string, number | Record<string, number>>;
  errors?: number;
  cost?: number;
  models?: Weighted[];
  loops?: number;
  fields?: Record<string, number>;
  reviewShare?: number;
  generative?: Partial<Record<DashboardsDemoGenerativeAction, number>>;
  feedbackDown?: number;
  kappa?: Record<string, number>;
  rampDays?: number;
  untilDay?: number;
}

export interface DashboardsDemoChange {
  /** The prototype's day, 0..89; day 89 is today. */
  day: number;
  kind: string;
  label: string;
  version?: string;
  effect?: DashboardsDemoEffect;
}

export interface DashboardsDemoProjectSpec {
  archetype: DashboardsDemoArchetype;
  /** The fictional prototype org the project came from. */
  prototypeOrg: string;
  id: string;
  description: string;
  traffic: {
    reqPerDay: number;
    tokPerReq: number;
    models: Weighted[];
    errRate?: number;
    p95Ms?: number;
    flat?: boolean;
  };
  coverage: DashboardsDemoCoverage;
  evaluators: DashboardsDemoEvaluator[];
  attention: {
    unit: string;
    label: string;
    values: Weighted[];
    names?: Record<string, string>;
  };
  languages?: Weighted[];
  outcomes: Record<DashboardsDemoOutcome, number>;
  /** [reason, the outcome it explains, weight] */
  failureReasons: [string, DashboardsDemoOutcome, number][];
  guardrails: DashboardsDemoGuardrail[];
  /** Extraction fields and their base accuracy. */
  fields?: Weighted[];
  reviewShare?: number;
  voiceStages?: Partial<Record<"stt" | "llm" | "tts", number>>;
  turnsPerCall?: number;
  generative?: Partial<Record<DashboardsDemoGenerativeAction, number>>;
  segmentShift?: Record<string, number>;
  thumbsUp: number;
  loopShare: number;
  retryShare: number;
  vocab: {
    names: string[];
    namesByTopic?: Record<string, string>;
    tools: string[];
    previews: Preview[];
    previewsByLang?: Record<string, Preview[]>;
    previewsByReason?: Record<string, Preview[]>;
    previewsByTopic?: Record<string, Preview[]>;
    errorTypes?: Weighted[];
    topics?: Weighted[];
    /** [topic, weight once ramped up, first prototype day] */
    newTopics?: [string, number, number][];
    cannotDo?: Record<string, Preview[]>;
    retrieval?: boolean;
    inRatio: number;
  };
  changes: DashboardsDemoChange[];
}
