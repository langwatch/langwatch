import { describe, expect, it } from "vitest";

import { getLatestUpdatedAt } from "./triggers";
import type { ElasticSearchTrace } from "../../server/tracer/types";

describe("utils test", () => {
  it("gets the latest updated at time", async () => {
    const latestUpdatedAt = getLatestUpdatedAt(traces);

    expect(latestUpdatedAt).toBe(1716223067051);
  });
});

const traces: { groups: ElasticSearchTrace[][] } = {
  groups: [
    [
      {
        trace_id: "trace_cs2X7LExGsbK837WGlVja",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1716223060415,
          inserted_at: 1716223067051,
          updated_at: 1716223067051,
        },
        input: {
          value: "I'm good, don't need any assistance, thanks!",
          satisfaction_score: 1,
        },
        output: {
          value:
            "That's great! If you do need anything in the future, don't hesitate to ask. Have a lovely day!",
        },
        metrics: {
          first_token_ms: 1260,
          total_time_ms: 2073,
          prompt_tokens: 17,
          completion_tokens: 24,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["66d5f6f8d9ca1af1db4ebea37fb0750c"],
      },
    ],
    [
      {
        trace_id: "trace_3E03kvXaTFbkMuzQ-dXFD",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1716210300468,
          inserted_at: 1716210310197,
          updated_at: 1716210310197,
        },
        input: {
          value: "once again",
          satisfaction_score: 0.5534973683536608,
        },
        output: {
          value: "Thank you for your kind words! How can I assist you today?",
        },
        metrics: {
          first_token_ms: 1123,
          total_time_ms: 5065,
          prompt_tokens: 7,
          completion_tokens: 14,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["9c44c39105cbca67a4d9c75942692c53"],
      },
    ],
    [
      {
        trace_id: "trace_95VKIpenp8mtKBAy-WEBb",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1716204645582,
          inserted_at: 1716204648910,
          updated_at: 1716204648910,
        },
        input: {
          value: "ahoooy",
          satisfaction_score: 0.8794623290453495,
        },
        output: {
          value: "Hello! How can I assist you today?",
        },
        metrics: {
          first_token_ms: 616,
          total_time_ms: 1664,
          prompt_tokens: 7,
          completion_tokens: 9,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["82228ea7a5d320191e9a464b6d34fd45"],
      },
    ],
    [
      {
        trace_id: "trace_E-xU_1katQC6yMSLb9wIx",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1716204362685,
          inserted_at: 1716204369526,
          updated_at: 1716204369526,
        },
        input: {
          value: "ahoy captain",
          satisfaction_score: 0.5796681572990974,
        },
        output: {
          value: "",
        },
        metrics: {
          first_token_ms: 3762,
          total_time_ms: 4816,
          prompt_tokens: 8,
          completion_tokens: 15,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["a85a12f9fe96f6cf9692e057794a51ba"],
      },
    ],
    [
      {
        trace_id: "trace_1qfE83uw3sKRmQZRUAVIx",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1716204154957,
          inserted_at: 1716204168035,
          updated_at: 1716204168035,
        },
        input: {
          value: "once again",
          satisfaction_score: 0.5534973683536608,
        },
        output: {
          value: "",
        },
        metrics: {
          first_token_ms: 1391,
          total_time_ms: 5048,
          prompt_tokens: 7,
          completion_tokens: 20,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["4608d40dfda4588b4bff5f1dbd65150b"],
      },
    ],
    [
      {
        trace_id: "trace_rDroeREHQqGw89U_YriJf",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1716204087699,
          inserted_at: 1716204090482,
          updated_at: 1716204090482,
        },
        input: {
          value: "all good?",
          satisfaction_score: 1,
        },
        output: {
          value: "",
        },
        metrics: {
          first_token_ms: 848,
          total_time_ms: 1087,
          prompt_tokens: 8,
          completion_tokens: 13,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["c7c6c9dbc9f467dd5ec3633f97e7a561"],
      },
    ],
    [
      {
        trace_id: "trace_VClblvwIRKLEhOATRBPVx",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1716203679711,
          inserted_at: 1716203686455,
          updated_at: 1716203686455,
        },
        input: {
          value: "ahoy captain",
          satisfaction_score: 0.5793251242223786,
        },
        output: {
          value: "",
        },
        metrics: {
          first_token_ms: 811,
          total_time_ms: 1784,
          prompt_tokens: 8,
          completion_tokens: 12,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["7ac4b05546dcef252fdc627975dc9b01"],
      },
    ],
    [
      {
        trace_id: "trace_Psci-AgM6OrhDwQf3dIeB",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1715955774319,
          inserted_at: 1715955810359,
          updated_at: 1715955810359,
        },
        input: {
          value: "help me with my emails, write a long text for it",
          satisfaction_score: -0.10146824473126762,
        },
        output: {
          value: "",
        },
        metrics: {
          first_token_ms: 1325,
          total_time_ms: 34495,
          prompt_tokens: 18,
          completion_tokens: 506,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["a5521e282bc50074d55c0fe56a231b96"],
      },
    ],
    [
      {
        trace_id: "trace_ib2Aaub8u6OI6K76Ab1wa",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1715955494861,
          inserted_at: 1715955514602,
          updated_at: 1715955514602,
        },
        input: {
          value: "help me with my emails, write a long text for it",
          satisfaction_score: -0.10146824473126762,
        },
        output: {
          value: "",
        },
        metrics: {
          first_token_ms: 1122,
          total_time_ms: 18139,
          prompt_tokens: 18,
          completion_tokens: 277,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["56b64a2aa84d5a6b44ee3aafa7a57d6f"],
      },
    ],
    [
      {
        trace_id: "trace_d4C9d8mkyUcIesH8la3Cs",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1715955477040,
          inserted_at: 1715955484972,
          updated_at: 1715955484972,
        },
        input: {
          value: "help me with my emails, write a long text for it",
          satisfaction_score: -0.10146824473126762,
        },
        output: {
          value: "",
        },
        metrics: {
          first_token_ms: 916,
          total_time_ms: 6371,
          prompt_tokens: 30,
          completion_tokens: 66,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["489925dd4e26b064bf60aabb245ae420"],
      },
    ],
    [
      {
        trace_id: "trace_kAjZ0SantWTH8-ACBW7U7",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {},
        timestamps: {
          started_at: 1715955425823,
          inserted_at: 1715955434425,
          updated_at: 1715955434425,
        },
        input: {
          value: "write me a long poem about my emails",
          satisfaction_score: -0.024726796491162113,
        },
        output: {
          value: "",
        },
        metrics: {
          first_token_ms: 438,
          total_time_ms: 6846,
          prompt_tokens: 26,
          completion_tokens: 228,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["f12d2d512e54267d1fe20369429ced97"],
      },
    ],

    [
      {
        trace_id: "trace_Hmq0mqJGUgimPZ4usaXiy",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        metadata: {
          customer_id: "customer_example",
          labels: ["v1.0.0"],
        },
        timestamps: {
          started_at: 1715939621502,
          inserted_at: 1715939624074,
          updated_at: 1715939624074,
        },
        input: {
          value: "hi",
          satisfaction_score: 0.8836860845329563,
        },
        output: {
          value: "👋 Hello! How can I help you today?",
        },
        metrics: {
          first_token_ms: null,
          total_time_ms: 691,
          prompt_tokens: 26,
          completion_tokens: 12,
          tokens_estimated: true,
        },
        error: null,
        indexing_md5s: ["6eced11be07c56f9a22b4504913958c7"],
      },
    ],
  ],
};
