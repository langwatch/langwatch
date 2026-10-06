/**
 * GENERATED once, then committed: one LLM Ops project per agent type, exported from the
 * prototype langwatch/new-structure at d8eb816 with its archetype defaults applied.
 */

import type { DashboardsDemoProjectSpec } from "./dashboards-demo-spec.ts";

export const DASHBOARDS_DEMO_PROJECT_SPECS: readonly DashboardsDemoProjectSpec[] = [
  {
    "archetype": "support-bot",
    "prototypeOrg": "Contoso Retail",
    "id": "shop-assistant",
    "description": "Shopper-facing chat for orders, returns and product questions",
    "traffic": {
      "reqPerDay": 1650,
      "tokPerReq": 2600,
      "models": [
        [
          "gpt-5-mini",
          0.9
        ],
        [
          "gpt-5",
          0.1
        ]
      ],
      "errRate": 0.009,
      "p95Ms": 2900,
      "flat": true
    },
    "coverage": {
      "cost": 1,
      "model": 1,
      "user_id": 0.71,
      "thread_id": 0.96,
      "customer_id": 0,
      "labels": 0.2,
      "prompt_id": 0.88,
      "outcome": 0.1,
      "feedback": 0.1,
      "guardrail": 0.4,
      "language": 0,
      "ttft": 0
    },
    "evaluators": [
      {
        "id": "answer-quality",
        "name": "Answer Quality Judge",
        "sampleRate": 0.2,
        "passRate": 0.87,
        "threshold": 0.8
      },
      {
        "id": "policy-adherence",
        "name": "Returns Policy Judge",
        "sampleRate": 0.2,
        "passRate": 0.94,
        "threshold": 0.9
      },
      {
        "id": "outcome-judge",
        "name": "Conversation Outcome Judge",
        "sampleRate": 0.1,
        "passRate": 0.79,
        "threshold": 0.72
      }
    ],
    "attention": {
      "unit": "topic",
      "label": "Topics",
      "values": [
        [
          "order status",
          0.3
        ],
        [
          "returns",
          0.22
        ],
        [
          "product questions",
          0.26
        ],
        [
          "discounts",
          0.12
        ],
        [
          "account",
          0.1
        ]
      ]
    },
    "outcomes": {
      "resolved": 0.7440424177236855,
      "misunderstood": 0.0859575822763145,
      "capability_gap": 0.04,
      "refusal": 0.04,
      "handover": 0.09
    },
    "failureReasons": [
      [
        "Intent misread",
        "misunderstood",
        0.55
      ],
      [
        "Wrong record looked up",
        "misunderstood",
        0.45
      ],
      [
        "Product or item not in the catalogue",
        "capability_gap",
        0.6
      ],
      [
        "Change the bot cannot make",
        "capability_gap",
        0.4
      ],
      [
        "Out of scope request",
        "refusal",
        1
      ],
      [
        "User asked for a person",
        "handover",
        0.6
      ],
      [
        "Complaint escalated",
        "handover",
        0.4
      ]
    ],
    "guardrails": [
      {
        "id": "pii",
        "name": "PII",
        "coverage": 0.4,
        "blockRate": 0.004,
        "flagRate": 0.006
      },
      {
        "id": "injection",
        "name": "Prompt injection",
        "coverage": 0.4,
        "blockRate": 0.0015,
        "flagRate": 0.002
      },
      {
        "id": "policy",
        "name": "Content policy",
        "coverage": 0.4,
        "blockRate": 0.0008,
        "flagRate": 0.009
      }
    ],
    "thumbsUp": 0.92,
    "loopShare": 0.006,
    "retryShare": 0.02,
    "vocab": {
      "names": [
        "chat_turn",
        "order_status",
        "return_request",
        "product_question",
        "handover"
      ],
      "namesByTopic": {
        "order status": "order_status",
        "returns": "return_request",
        "product questions": "product_question",
        "discounts": "chat_turn",
        "account": "chat_turn"
      },
      "tools": [
        "lookup_order",
        "search_catalogue",
        "create_return",
        "check_stock",
        "handover_to_agent"
      ],
      "previews": [
        [
          "Where is my order 55120? It said Tuesday.",
          "Order 55120 left the warehouse yesterday and is with the courier. The new estimate is Thursday, and I sent the tracking link to your email."
        ],
        [
          "Can I return the blue jacket if I wore it once?",
          "Items can be returned within 30 days if they are unworn with tags. I can open a return so a colleague reviews the condition."
        ],
        [
          "Do you have the trail runner in size 44?",
          "The trail runner in size 44 is in stock in black and grey. I can reserve one for you at checkout."
        ],
        [
          "Is the new wool overshirt machine washable?",
          "I could not find care details for that item yet. I am passing you to a colleague in Customer Care who can check the label for you."
        ],
        [
          "The discount code WELCOME10 is not working",
          "WELCOME10 applies to first orders only. Your account has a previous order, so I applied the loyalty code instead."
        ],
        [
          "Which of the autumn boots are waterproof?",
          "I do not have material details for the autumn range yet. A colleague can confirm which models are waterproof; shall I connect you?"
        ],
        [
          "I want to talk to a person",
          "I am connecting you with a colleague from Customer Care. The current wait is about 4 minutes."
        ]
      ],
      "previewsByReason": {
        "Intent misread": [
          [
            "I want to change the size on my order",
            "To start a return, pick the item and the reason. A courier label will be emailed to you."
          ],
          [
            "Can I add a gift note?",
            "Our gift cards come in 25, 50 and 100. Which amount would you like?"
          ]
        ],
        "Wrong record looked up": [
          [
            "Where is order 55190?",
            "Order 55109 was delivered on Monday and signed for at the door."
          ],
          [
            "My return for the scarf, any news?",
            "Your return for the leather belt was refunded on Jul 28."
          ]
        ],
        "Product or item not in the catalogue": [
          [
            "Is the new wool overshirt machine washable?",
            "I could not find care details for that item yet. I am passing you to a colleague in Customer Care who can check the label."
          ],
          [
            "Which of the autumn boots are waterproof?",
            "I do not have material details for the autumn range yet. A colleague can confirm which models are waterproof."
          ],
          [
            "Does the Harbour parka run small?",
            "I have no sizing notes for the Harbour parka. Let me connect you with Customer Care."
          ],
          [
            "What is the lining of the corduroy blazer made of?",
            "The catalogue has no material details for that blazer yet, so I am handing you to a colleague."
          ]
        ],
        "Change the bot cannot make": [
          [
            "Please change the delivery address on order 55233",
            "I cannot change an address once the order is packed. A colleague from Customer Care can try with the courier."
          ],
          [
            "Split my order into two deliveries",
            "I cannot split an order that is already confirmed. I am passing you to Customer Care."
          ]
        ],
        "Out of scope request": [
          [
            "Can you recommend a good tailor near me?",
            "I can only help with orders, returns and our products, so I cannot recommend a tailor."
          ],
          [
            "Write me a poem about shoes",
            "I can only help with orders, returns and our products."
          ]
        ],
        "User asked for a person": [
          [
            "I want to talk to a person",
            "I am connecting you with a colleague from Customer Care. The current wait is about 4 minutes."
          ],
          [
            "Agent please",
            "Sure, I am connecting you with Customer Care now."
          ]
        ],
        "Complaint escalated": [
          [
            "This is the third time my parcel is late, I am done",
            "I am sorry about the repeated delays. I am passing this to a Customer Care lead who will follow up today."
          ],
          [
            "The jacket fell apart after one wash",
            "Sorry to hear that. I logged a complaint and a colleague will contact you about a refund."
          ]
        ]
      },
      "previewsByTopic": {
        "order status": [
          [
            "Where is my order 55120? It said Tuesday.",
            "Order 55120 left the warehouse yesterday and is with the courier. The new estimate is Thursday; the tracking link is in your email."
          ],
          [
            "Has my order shipped yet?",
            "Yes, order 55318 shipped this morning. It should arrive Wednesday."
          ]
        ],
        "returns": [
          [
            "Can I return the blue jacket if I wore it once?",
            "Items can be returned within 30 days if unworn with tags. I opened a return so a colleague reviews the condition."
          ],
          [
            "How do I send back the sneakers?",
            "I created return R-8812. Print the label from your email and drop the parcel at any pickup point."
          ]
        ],
        "product questions": [
          [
            "Do you have the trail runner in size 44?",
            "The trail runner in size 44 is in stock in black and grey. I can reserve one at checkout."
          ],
          [
            "Is the linen shirt available in navy?",
            "Yes, the linen shirt comes in navy from S to XL, all in stock."
          ]
        ],
        "discounts": [
          [
            "The discount code WELCOME10 is not working",
            "WELCOME10 applies to first orders only. Your account has a previous order, so I applied the loyalty code instead."
          ],
          [
            "Is there a student discount?",
            "Yes, 10% with a verified student account. I sent you the verification link."
          ]
        ],
        "account": [
          [
            "I forgot my password",
            "I sent a reset link to the email on your account. It is valid for one hour."
          ],
          [
            "How do I change my email address?",
            "Open Account, then Details, and edit the email. We will send a confirmation to the new address."
          ]
        ]
      },
      "errorTypes": [
        [
          "timeout",
          0.4
        ],
        [
          "tool_error",
          0.3
        ],
        [
          "empty_retrieval",
          0.2
        ],
        [
          "rate_limit",
          0.1
        ]
      ],
      "topics": [
        [
          "order status",
          0.3
        ],
        [
          "returns",
          0.22
        ],
        [
          "product questions",
          0.26
        ],
        [
          "discounts",
          0.12
        ],
        [
          "account",
          0.1
        ]
      ],
      "newTopics": [
        [
          "gift cards",
          0.08,
          66
        ]
      ],
      "cannotDo": {
        "order status": [
          [
            "Can you change my delivery to a pickup point?",
            "I can't change the delivery method once an order ships."
          ]
        ],
        "returns": [
          [
            "Book the courier to collect my return tomorrow",
            "I can't book collections. You can drop the parcel at any partner shop."
          ]
        ],
        "product questions": [
          [
            "Do you have the wool overshirt in XXL in the Lyon store?",
            "I can't see store stock, only online stock."
          ]
        ],
        "discounts": [
          [
            "Apply my student discount to last week's order",
            "I can't add discounts to past orders."
          ]
        ],
        "account": [
          [
            "Merge my two accounts",
            "I can't merge accounts. Customer care can."
          ]
        ],
        "gift cards": [
          [
            "Check the balance of my gift card",
            "I can't read gift card balances yet."
          ]
        ]
      },
      "retrieval": true,
      "inRatio": 0.66
    },
    "changes": [
      {
        "day": 74,
        "kind": "deploy",
        "label": "Deploy tag catalogue-autumn-26",
        "version": "catalogue-autumn-26",
        "effect": {
          "outcome": {
            "capability_gap": 0.07,
            "resolved": -0.07
          },
          "failureReasons": {
            "Product or item not in the catalogue": 2.5
          },
          "evals": {
            "outcome-judge": -0.07,
            "answer-quality": -0.03
          },
          "segments": {
            "product questions": -0.12
          },
          "topics": {
            "product questions": -0.12
          }
        }
      }
    ]
  },
  {
    "archetype": "rag",
    "prototypeOrg": "ACME",
    "id": "docs-rag",
    "description": "RAG search over product documentation",
    "traffic": {
      "reqPerDay": 900,
      "tokPerReq": 2200,
      "models": [
        [
          "gpt-5-mini",
          0.7
        ],
        [
          "gemini-2.5-pro",
          0.3
        ]
      ],
      "errRate": 0.011,
      "p95Ms": 1600
    },
    "coverage": {
      "cost": 1,
      "model": 1,
      "user_id": 0.62,
      "thread_id": 0.4,
      "customer_id": 0,
      "labels": 0.35,
      "prompt_id": 0.3,
      "outcome": 0,
      "feedback": 0.04,
      "guardrail": 1,
      "language": 0,
      "ttft": 0
    },
    "evaluators": [
      {
        "id": "prompt-injection",
        "name": "Prompt Injection Detector",
        "sampleRate": 1,
        "passRate": 0.995,
        "threshold": 0.99
      },
      {
        "id": "faithfulness",
        "name": "Faithfulness Judge",
        "sampleRate": 0.1,
        "passRate": 0.86,
        "threshold": 0.8
      }
    ],
    "attention": {
      "unit": "flow",
      "label": "Flows",
      "values": [
        [
          "docs_search",
          0.9791238391771913
        ],
        [
          "answer_question",
          0.3907441600535785
        ],
        [
          "suggest_related",
          0.36690205006594395
        ]
      ]
    },
    "outcomes": {
      "resolved": 0.7084478212706744,
      "misunderstood": 0.09155217872932553,
      "capability_gap": 0.07,
      "refusal": 0.04,
      "handover": 0.09
    },
    "failureReasons": [
      [
        "Question misread",
        "misunderstood",
        1
      ],
      [
        "No document covers it",
        "capability_gap",
        0.7
      ],
      [
        "Document out of date",
        "capability_gap",
        0.3
      ],
      [
        "No source found, declined to answer",
        "refusal",
        1
      ],
      [
        "Asked for a person",
        "handover",
        1
      ]
    ],
    "guardrails": [
      {
        "id": "pii",
        "name": "PII",
        "coverage": 1,
        "blockRate": 0.004,
        "flagRate": 0.006
      },
      {
        "id": "injection",
        "name": "Prompt injection",
        "coverage": 1,
        "blockRate": 0.0015,
        "flagRate": 0.002
      },
      {
        "id": "policy",
        "name": "Content policy",
        "coverage": 0.8999999999999999,
        "blockRate": 0.0008,
        "flagRate": 0.009
      }
    ],
    "thumbsUp": 0.87,
    "loopShare": 0.003,
    "retryShare": 0.02,
    "vocab": {
      "names": [
        "docs_search",
        "answer_question",
        "suggest_related"
      ],
      "tools": [
        "embed_query",
        "vector_search",
        "rerank"
      ],
      "previews": [
        [
          "How do I rotate a virtual key without downtime?",
          "Create a second key on the same scope, roll deployments to it, then revoke the old key. Budgets attach to the scope, so they transfer automatically."
        ],
        [
          "What are the latest papers on sparse attention?",
          "I found 3 relevant papers. The most notable one proposes a sparse attention mechanism that reduces compute by 40%."
        ],
        [
          "Does the SDK support streaming tool calls?",
          "Yes, from v0.9 the SDK streams tool call deltas. Example with the on_tool_delta callback included below."
        ],
        [
          "Where do I configure fallback models?",
          "Fallbacks live in the routing pool config: set fallbacks per pool and the gateway retries in order on 5xx or timeout."
        ],
        [
          "How is cost attributed for cached tokens?",
          "Cached input tokens are billed at the provider's cache-read rate and reported separately in usage rows as tokens_cached."
        ]
      ],
      "errorTypes": [
        [
          "timeout",
          0.3
        ],
        [
          "empty_retrieval",
          0.4
        ],
        [
          "rate_limit",
          0.2
        ],
        [
          "validation",
          0.1
        ]
      ],
      "topics": [
        [
          "virtual keys",
          0.25
        ],
        [
          "sdk",
          0.3
        ],
        [
          "routing",
          0.2
        ],
        [
          "billing",
          0.25
        ]
      ],
      "newTopics": [
        [
          "mcp server",
          0.09,
          62
        ]
      ],
      "cannotDo": {
        "virtual keys": [
          [
            "Can a virtual key expire after 24 hours?",
            "The docs don't cover key expiry. I can't confirm it is supported."
          ]
        ],
        "sdk": [
          [
            "Is there a Rust SDK?",
            "No page covers a Rust SDK, so I can't say how to use one."
          ]
        ],
        "routing": [
          [
            "Route requests by user country",
            "None of the routing docs cover country-based rules."
          ]
        ],
        "billing": [
          [
            "Can I get invoices per team?",
            "The billing docs don't cover per-team invoices."
          ]
        ],
        "mcp server": [
          [
            "How do I connect the MCP server to Cursor?",
            "There is no doc on the MCP server yet."
          ]
        ]
      },
      "retrieval": true,
      "inRatio": 0.57
    },
    "changes": []
  },
  {
    "archetype": "vendor",
    "prototypeOrg": "Globex",
    "id": "support-agents",
    "description": "White-label support agent running one config per customer tenant",
    "traffic": {
      "reqPerDay": 5200,
      "tokPerReq": 3400,
      "models": [
        [
          "claude-sonnet-4.5",
          0.6
        ],
        [
          "gpt-5-mini",
          0.4
        ]
      ],
      "errRate": 0.012,
      "p95Ms": 3300
    },
    "coverage": {
      "cost": 1,
      "model": 1,
      "user_id": 0.84,
      "thread_id": 0.97,
      "customer_id": 1,
      "labels": 0.9,
      "prompt_id": 0.99,
      "outcome": 0.35,
      "feedback": 0.06,
      "guardrail": 0.5,
      "language": 0.2,
      "ttft": 0
    },
    "evaluators": [
      {
        "id": "resolution",
        "name": "Resolution Judge",
        "sampleRate": 0.15,
        "passRate": 0.87,
        "threshold": 0.8
      },
      {
        "id": "brand-voice",
        "name": "Brand Voice Judge",
        "sampleRate": 0.1,
        "passRate": 0.92,
        "threshold": 0.85
      },
      {
        "id": "tenant-policy",
        "name": "Tenant Policy Check",
        "sampleRate": 1,
        "passRate": 0.985,
        "threshold": 0.97
      }
    ],
    "attention": {
      "unit": "tenant",
      "label": "Customers",
      "values": [
        [
          "t-01",
          0.1548917007006646
        ],
        [
          "t-02",
          0.08853583394869499
        ],
        [
          "t-03",
          0.0770066957537588
        ],
        [
          "t-04",
          0.048231429822109644
        ],
        [
          "t-05",
          0.05953650724259439
        ],
        [
          "t-06",
          0.035512954151689306
        ],
        [
          "t-07",
          0.041682279610263856
        ],
        [
          "t-08",
          0.03748274879426468
        ],
        [
          "t-09",
          0.02990407208262339
        ],
        [
          "t-10",
          0.027472032917385352
        ],
        [
          "t-11",
          0.021088088827309143
        ],
        [
          "t-12",
          0.027263515776131814
        ],
        [
          "t-13",
          0.017404247863734786
        ],
        [
          "t-14",
          0.022063347347764994
        ],
        [
          "t-15",
          0.01981425293830031
        ],
        [
          "t-16",
          0.02002873030483663
        ],
        [
          "t-17",
          0.014306553578508217
        ],
        [
          "t-18",
          0.012533027129634411
        ],
        [
          "t-19",
          0.018186705025805258
        ],
        [
          "t-20",
          0.018638051017070445
        ],
        [
          "t-21",
          0.0145212120568826
        ],
        [
          "t-22",
          0.012290849345265508
        ],
        [
          "t-23",
          0.010365583629549781
        ],
        [
          "t-24",
          0.013746867808996574
        ],
        [
          "t-25",
          0.01526450075914477
        ],
        [
          "t-26",
          0.01155005791313928
        ],
        [
          "t-27",
          0.012769131673914318
        ],
        [
          "t-28",
          0.009483316480483688
        ],
        [
          "t-29",
          0.010142850592336852
        ],
        [
          "t-30",
          0.00858208438245649
        ],
        [
          "t-31",
          0.010599883425213792
        ],
        [
          "t-32",
          0.011515359079421342
        ],
        [
          "t-33",
          0.011455630030741208
        ],
        [
          "t-34",
          0.00764465330907428
        ],
        [
          "t-35",
          0.007454476697829838
        ],
        [
          "t-36",
          0.008748038679909665
        ],
        [
          "t-37",
          0.007557953706090689
        ],
        [
          "t-38",
          0.006943535044797464
        ],
        [
          "t-39",
          0.007352418372666459
        ],
        [
          "t-40",
          0.010428822178940172
        ]
      ],
      "names": {
        "t-01": "Pinecrest Health",
        "t-02": "Bluefin Travel",
        "t-03": "Larkspur Insurance",
        "t-04": "Orbitwise Software",
        "t-05": "Kettlebrook Fitness",
        "t-06": "Fernhill Academy",
        "t-07": "Tidewater Marinas",
        "t-08": "Saffron Table",
        "t-09": "Quillstone Publishing",
        "t-10": "Sunvale Energy",
        "t-11": "Redwood Rentals",
        "t-12": "Lumen Opticians",
        "t-13": "Granite Peak Outfitters",
        "t-14": "Marigold Florals",
        "t-15": "Copperleaf Homes",
        "t-16": "Driftwood Hotels",
        "t-17": "Northgate Storage",
        "t-18": "Hollowbrook Vets",
        "t-19": "Silverline Couriers",
        "t-20": "Brambleworks",
        "t-21": "Cobalt Cycles",
        "t-22": "Juniper Legal",
        "t-23": "Waypoint Movers",
        "t-24": "Ashgrove Dental",
        "t-25": "Wrenfield Payroll",
        "t-26": "Meadowlark Pets",
        "t-27": "Ironbridge Tools",
        "t-28": "Clearwater Pools",
        "t-29": "Peppercorn Catering",
        "t-30": "Harborview Clinics",
        "t-31": "Oakmoss Candles",
        "t-32": "Riverstone Realty",
        "t-33": "Glasshouse Studios",
        "t-34": "Thistle Tea Co",
        "t-35": "Brightwater Labs",
        "t-36": "Mossgate Gardens",
        "t-37": "Velvet Ridge Wines",
        "t-38": "Lanternfish Games",
        "t-39": "Kiteline Surf",
        "t-40": "Ember & Oak"
      }
    },
    "outcomes": {
      "resolved": 0.755938039086759,
      "misunderstood": 0.04406196091324091,
      "capability_gap": 0.07,
      "refusal": 0.04,
      "handover": 0.09
    },
    "failureReasons": [
      [
        "Answered from the wrong tenant knowledge",
        "misunderstood",
        0.4
      ],
      [
        "Intent misread",
        "misunderstood",
        0.6
      ],
      [
        "Feature not configured for the tenant",
        "capability_gap",
        1
      ],
      [
        "Out of scope request",
        "refusal",
        1
      ],
      [
        "User asked for a person",
        "handover",
        0.55
      ],
      [
        "Billing dispute escalated",
        "handover",
        0.45
      ]
    ],
    "guardrails": [
      {
        "id": "pii",
        "name": "PII",
        "coverage": 0.5,
        "blockRate": 0.004,
        "flagRate": 0.006
      },
      {
        "id": "injection",
        "name": "Prompt injection",
        "coverage": 0.5,
        "blockRate": 0.0015,
        "flagRate": 0.002
      },
      {
        "id": "policy",
        "name": "Content policy",
        "coverage": 0.5,
        "blockRate": 0.0008,
        "flagRate": 0.009
      }
    ],
    "thumbsUp": 0.9,
    "loopShare": 0.01,
    "retryShare": 0.03,
    "vocab": {
      "names": [
        "agent_turn",
        "lookup_account",
        "resolve_ticket",
        "escalate",
        "summarize_conversation"
      ],
      "tools": [
        "tenant_kb_search",
        "crm_lookup",
        "create_ticket",
        "refund_tool",
        "handover"
      ],
      "previews": [
        [
          "My invoice shows a seat I removed last month.",
          "I checked your billing history: the seat was removed on the 3rd, after the invoice closed. I issued a credit for the prorated amount."
        ],
        [
          "How do I reset two-factor for a team member?",
          "As an admin, open Members, choose the person and select Reset two-factor. They will be asked to set it up again at next sign in."
        ],
        [
          "The integration with our CRM stopped syncing.",
          "The CRM token expired yesterday. I sent the reconnect link to the workspace owner and queued a resync for when it is back."
        ],
        [
          "Can you cancel my subscription?",
          "I can help with that. Before I cancel, would a pause for up to three months work better? If not, I will cancel at the end of this period."
        ],
        [
          "My boat lift booking shows the wrong dock.",
          "I am handing you to a colleague now. They will contact you shortly."
        ],
        [
          "Your agent gave me the wrong opening hours.",
          "Sorry about that. The correct hours are 9:00 to 18:00 on weekdays. I flagged the answer so the team can fix the source."
        ]
      ],
      "previewsByReason": {
        "Answered from the wrong tenant knowledge": [
          [
            "What time does the marina office open?",
            "Our studio opens at 7:00 for early yoga classes."
          ],
          [
            "Do you deliver on Sundays?",
            "Our gym is open on Sundays from 9 to 17."
          ]
        ],
        "Intent misread": [
          [
            "I want to remove a seat",
            "To add a seat, open Members and choose Invite."
          ],
          [
            "Can you move my renewal date?",
            "Your plan renews automatically every month on the 3rd."
          ]
        ],
        "Feature not configured for the tenant": [
          [
            "Can I book a class through this chat?",
            "Booking is not set up for this workspace yet. I am handing you to a colleague."
          ],
          [
            "Send me my last three invoices",
            "Invoice lookup is not enabled for your account, so I cannot fetch them here."
          ]
        ],
        "Out of scope request": [
          [
            "Can you help me file my taxes?",
            "I can only help with your account, billing and our product."
          ],
          [
            "What do you think of your competitor?",
            "I can only help with questions about your account and our product."
          ]
        ],
        "User asked for a person": [
          [
            "I need a human please",
            "I am handing you to a colleague now. They will contact you shortly."
          ],
          [
            "Can someone call me?",
            "I am handing you to a colleague, who will call you back today."
          ]
        ],
        "Billing dispute escalated": [
          [
            "You charged me twice this month",
            "I can see two charges on Jul 30. I am passing this to the billing team to review and refund the duplicate."
          ],
          [
            "I never agreed to the price increase",
            "I am sorry. I am escalating this to billing, who will reply by email within one business day."
          ]
        ]
      },
      "previewsByTopic": {
        "billing": [
          [
            "My invoice shows a seat I removed last month.",
            "The seat was removed on the 3rd, after the invoice closed. I issued a credit for the prorated amount."
          ],
          [
            "Can I pay yearly instead?",
            "Yes. Switching to yearly saves two months; I can change it from your next renewal."
          ]
        ],
        "account access": [
          [
            "How do I reset two-factor for a team member?",
            "As an admin, open Members, choose the person and select Reset two-factor."
          ],
          [
            "I am locked out of my account",
            "I sent a sign-in link to your email. It is valid for 15 minutes."
          ]
        ],
        "integrations": [
          [
            "The integration with our CRM stopped syncing.",
            "The CRM token expired yesterday. I sent the reconnect link to the workspace owner and queued a resync."
          ],
          [
            "How do I connect our calendar?",
            "Open Settings, then Integrations, and choose your calendar provider."
          ]
        ],
        "cancellation": [
          [
            "Can you cancel my subscription?",
            "Before I cancel, would a pause for up to three months work better? If not, I will cancel at the end of this period."
          ],
          [
            "Please pause my plan for August",
            "Done. Your plan is paused until Sep 1 and you will not be charged for August."
          ]
        ],
        "how to": [
          [
            "How do I export my client list?",
            "Open Clients, select all and choose Export. You will get a CSV by email."
          ],
          [
            "Where do I change the opening hours shown to customers?",
            "Open Settings, then Business details, and edit Opening hours."
          ]
        ]
      },
      "errorTypes": [
        [
          "tool_error",
          0.4
        ],
        [
          "timeout",
          0.35
        ],
        [
          "rate_limit",
          0.15
        ],
        [
          "validation",
          0.1
        ]
      ],
      "topics": [
        [
          "billing",
          0.3
        ],
        [
          "account access",
          0.22
        ],
        [
          "integrations",
          0.2
        ],
        [
          "cancellation",
          0.12
        ],
        [
          "how to",
          0.16
        ]
      ],
      "newTopics": [
        [
          "data export",
          0.07,
          66
        ]
      ],
      "cannotDo": {
        "billing": [
          [
            "Move us to invoice billing instead of card",
            "Invoice billing isn't set up for this account."
          ]
        ],
        "account access": [
          [
            "Remove 2FA for my colleague",
            "I can't change another member's security settings."
          ]
        ],
        "integrations": [
          [
            "Connect to our self-hosted Jira",
            "Self-hosted Jira isn't a supported integration."
          ]
        ],
        "cancellation": [
          [
            "Pause our plan for two months",
            "Pausing isn't enabled for this plan."
          ]
        ],
        "how to": [
          [
            "Can I schedule reports to Slack?",
            "Scheduled reports aren't configured for your workspace."
          ]
        ],
        "data export": [
          [
            "Export all our data to S3",
            "Data export isn't available on your plan."
          ]
        ]
      },
      "inRatio": 0.72
    },
    "changes": [
      {
        "day": 80,
        "kind": "base-prompt",
        "label": "support-agents base prompt v7, on 12 customers",
        "version": "v7",
        "effect": {
          "tenants": {
            "t-07": -0.22,
            "t-19": -0.18,
            "t-33": -0.25
          }
        }
      },
      {
        "day": 85,
        "kind": "config",
        "label": "gpt-5-mini starts taking traffic",
        "effect": {
          "cost": 0.92
        }
      }
    ]
  },
  {
    "archetype": "voice",
    "prototypeOrg": "Wonka Logistics",
    "id": "outbound-scheduling",
    "description": "Outbound voice calls that book and confirm delivery slots",
    "traffic": {
      "reqPerDay": 1400,
      "tokPerReq": 6800,
      "models": [
        [
          "gpt-5-mini",
          0.85
        ],
        [
          "claude-sonnet-4.5",
          0.15
        ]
      ],
      "errRate": 0.018,
      "p95Ms": 1600
    },
    "coverage": {
      "cost": 1,
      "model": 1,
      "user_id": 1,
      "thread_id": 1,
      "customer_id": 0,
      "labels": 0.4,
      "prompt_id": 0.8,
      "outcome": 1,
      "feedback": 0,
      "guardrail": 0,
      "language": 1,
      "ttft": 1
    },
    "evaluators": [
      {
        "id": "slot-booked",
        "name": "Slot Booked Check",
        "sampleRate": 1,
        "passRate": 0.78,
        "threshold": 0.74
      },
      {
        "id": "call-quality",
        "name": "Call Quality Judge",
        "sampleRate": 0.2,
        "passRate": 0.85,
        "threshold": 0.8
      },
      {
        "id": "no-repeat",
        "name": "Repeated Sentence Check",
        "sampleRate": 1,
        "passRate": 0.965,
        "threshold": 0.95
      }
    ],
    "attention": {
      "unit": "language",
      "label": "Languages",
      "values": [
        [
          "en",
          0.74
        ],
        [
          "es",
          0.18
        ],
        [
          "pt",
          0.08
        ]
      ],
      "names": {
        "en": "English",
        "es": "Spanish",
        "pt": "Portuguese"
      }
    },
    "languages": [
      [
        "en",
        0.74
      ],
      [
        "es",
        0.18
      ],
      [
        "pt",
        0.08
      ]
    ],
    "outcomes": {
      "resolved": 0.7129434830509126,
      "misunderstood": 0.08705651694908738,
      "capability_gap": 0.07,
      "refusal": 0.04,
      "handover": 0.09
    },
    "failureReasons": [
      [
        "Did not understand the slot",
        "misunderstood",
        0.6
      ],
      [
        "Talked over the customer",
        "misunderstood",
        0.4
      ],
      [
        "Request outside scheduling",
        "capability_gap",
        1
      ],
      [
        "Customer declined",
        "refusal",
        1
      ],
      [
        "Call not ended by the agent",
        "handover",
        0.5
      ],
      [
        "Callback requested",
        "handover",
        0.5
      ]
    ],
    "guardrails": [],
    "voiceStages": {
      "stt": 320,
      "llm": 650,
      "tts": 290
    },
    "turnsPerCall": 6,
    "thumbsUp": 0.9,
    "loopShare": 0.009,
    "retryShare": 0.025,
    "vocab": {
      "names": [
        "call",
        "call_turn",
        "book_slot",
        "confirm_address"
      ],
      "tools": [
        "stt",
        "llm_turn",
        "tts",
        "lookup_slots",
        "book_slot"
      ],
      "previews": [
        [
          "Hi, yes, Thursday morning works.",
          "Great, I have booked Thursday between 8 and 12. You will get a text the evening before."
        ],
        [
          "Can you come after 5? I work late.",
          "The latest slot this week is Friday from 16 to 20. Shall I book that one?"
        ],
        [
          "Who is this again?",
          "This is the delivery scheduling assistant from Wonka Logistics, calling about your parcel from Candy Corner."
        ],
        [
          "I moved last week, the address is wrong.",
          "I cannot change the address on a call, so I sent you a link to update it. I kept Thursday's slot for you."
        ]
      ],
      "previewsByLang": {
        "es": [
          [
            "Hola, sí, el martes por la tarde.",
            "Perfecto, he reservado el martes de 14 a 18. Recibirá un mensaje la tarde anterior."
          ],
          [
            "¿Puede venir después de las cinco?",
            "El último horario es el viernes de 16 a 20, se lo he reservado."
          ],
          [
            "¿Quién llama?",
            "Soy el asistente de entregas de Wonka Logistics, por su paquete de Candy Corner."
          ]
        ],
        "pt": [
          [
            "Olá, pode ser na quarta de manhã.",
            "Combinado, marquei quarta-feira entre as 8 e as 12. Vai receber uma mensagem na véspera."
          ],
          [
            "Só posso depois das cinco.",
            "O último horário é sexta das 16 às 20, já ficou marcado."
          ],
          [
            "Quem está a ligar?",
            "Sou o assistente de entregas da Wonka Logistics, sobre a sua encomenda da Candy Corner."
          ]
        ]
      },
      "previewsByReason": {
        "es|Did not understand the slot": [
          [
            "Quizás el de después de comer, pasado mañana.",
            "Tengo el jueves de 8 a 12. ¿Se lo reservo?"
          ]
        ],
        "es|Talked over the customer": [
          [
            "¿Hola? ¿Sigue ahí?",
            "(el cliente colgó durante una pausa de 2,1 s antes de la respuesta)"
          ],
          [
            "Sí, el martes... ¿hola?",
            "(el agente empezó a leer los horarios mientras el cliente hablaba)"
          ]
        ],
        "es|Request outside scheduling": [
          [
            "¿Qué hay en el paquete?",
            "Solo puedo ayudar con el horario de entrega. El remitente le puede decir qué se pidió."
          ]
        ],
        "es|Customer declined": [
          [
            "No, gracias, lo recojo yo.",
            "De acuerdo. El paquete queda en el almacén 7 días; le envié la dirección."
          ]
        ],
        "es|Call not ended by the agent": [
          [
            "(silencio)",
            "(la llamada siguió abierta 40 s después de que el cliente dejó de responder)"
          ]
        ],
        "es|Callback requested": [
          [
            "Estoy conduciendo, llámeme luego.",
            "Claro, le llamo después de las 18:00."
          ]
        ],
        "pt|Did not understand the slot": [
          [
            "Talvez depois do almoço, depois de amanhã.",
            "Tenho quinta das 8 às 12. Marco esse?"
          ]
        ],
        "pt|Talked over the customer": [
          [
            "Sim, na terça... está?",
            "(o agente começou a ler os horários enquanto o cliente falava)"
          ]
        ],
        "pt|Request outside scheduling": [
          [
            "O que vem na encomenda?",
            "Só posso ajudar com o horário de entrega. O remetente pode dizer-lhe o que foi pedido."
          ]
        ],
        "pt|Call not ended by the agent": [
          [
            "(silêncio)",
            "(a chamada ficou aberta 40 s depois de o cliente deixar de responder)"
          ]
        ],
        "pt|Customer declined": [
          [
            "Não, obrigado, vou buscar eu.",
            "Sem problema. A encomenda fica no armazém 7 dias; enviei-lhe a morada."
          ]
        ],
        "pt|Callback requested": [
          [
            "Estou a conduzir, ligue mais tarde.",
            "Claro, ligo-lhe depois das 18:00."
          ]
        ],
        "Did not understand the slot": [
          [
            "Maybe the one after lunch on the day after tomorrow?",
            "I have Thursday between 8 and 12. Shall I book that?"
          ]
        ],
        "Talked over the customer": [
          [
            "Hello? Are you still there?",
            "(the agent started reading the slots while the customer was still speaking)"
          ]
        ],
        "Request outside scheduling": [
          [
            "Can you tell me what is in the parcel?",
            "I can only help with the delivery slot. The sender can tell you what was ordered."
          ]
        ],
        "Customer declined": [
          [
            "No thanks, I will pick it up myself.",
            "No problem. The parcel stays at the depot for 7 days; I sent you the address."
          ]
        ],
        "Call not ended by the agent": [
          [
            "(silence)",
            "(the call stayed open for 40 s after the customer stopped responding)"
          ]
        ],
        "Callback requested": [
          [
            "I am driving, call me later",
            "Of course. I will call you back after 18:00 today."
          ]
        ]
      },
      "previewsByTopic": {
        "book slot": [
          [
            "Hi, yes, Thursday morning works.",
            "Great, I have booked Thursday between 8 and 12. You will get a text the evening before."
          ]
        ],
        "reschedule": [
          [
            "Can you come after 5? I work late.",
            "The latest slot this week is Friday from 16 to 20. I have moved your delivery there."
          ]
        ],
        "address change": [
          [
            "I moved last week, the address is wrong.",
            "I cannot change the address on a call, so I sent you a link to update it. I kept Thursday's slot for you."
          ]
        ],
        "who is calling": [
          [
            "Who is this again?",
            "This is the delivery scheduling assistant from Wonka Logistics, calling about your parcel from Candy Corner. Is Thursday morning good for you?"
          ]
        ]
      },
      "errorTypes": [
        [
          "tts_timeout",
          0.35
        ],
        [
          "stt_failure",
          0.25
        ],
        [
          "call_dropped",
          0.25
        ],
        [
          "tool_error",
          0.15
        ]
      ],
      "topics": [
        [
          "book slot",
          0.55
        ],
        [
          "reschedule",
          0.25
        ],
        [
          "address change",
          0.1
        ],
        [
          "who is calling",
          0.1
        ]
      ],
      "newTopics": [
        [
          "cancel slot",
          0.07,
          66
        ]
      ],
      "cannotDo": {
        "book slot": [
          [
            "Can the engineer come on Sunday?",
            "Weekend slots can't be booked by phone."
          ]
        ],
        "reschedule": [
          [
            "Move it to my office address instead",
            "I can only book at the address on the order."
          ]
        ],
        "address change": [
          [
            "Change the address on my contract",
            "I can't change contract details on this call."
          ]
        ],
        "who is calling": [
          [
            "Can I talk to my account manager?",
            "I can't transfer to account managers."
          ]
        ],
        "cancel slot": [
          [
            "Cancel my appointment",
            "I can't cancel appointments yet."
          ]
        ]
      },
      "inRatio": 0.78
    },
    "changes": [
      {
        "day": 77,
        "kind": "config",
        "label": "TTS model neural-hd-es on Spanish calls",
        "effect": {
          "segments": {
            "es": -0.11
          },
          "segmentLatency": {
            "es": {
              "tts": 3.1
            }
          },
          "p95": 1.12
        }
      },
      {
        "day": 83,
        "kind": "prompt",
        "label": "outbound-scheduling prompt v14",
        "version": "v14"
      }
    ]
  },
  {
    "archetype": "extraction",
    "prototypeOrg": "Initech",
    "id": "invoice-extraction",
    "description": "Extracts header and line items from supplier documents into the ERP",
    "traffic": {
      "reqPerDay": 6000,
      "tokPerReq": 5200,
      "models": [
        [
          "gpt-5",
          1
        ]
      ],
      "errRate": 0.015,
      "p95Ms": 7800,
      "flat": true
    },
    "coverage": {
      "cost": 1,
      "model": 1,
      "user_id": 0,
      "thread_id": 0,
      "customer_id": 0,
      "labels": 1,
      "prompt_id": 0.9,
      "outcome": 1,
      "feedback": 0,
      "guardrail": 0,
      "language": 0.3,
      "ttft": 0
    },
    "evaluators": [
      {
        "id": "field-accuracy",
        "name": "Field Accuracy Check",
        "sampleRate": 1,
        "passRate": 0.945,
        "threshold": 0.92
      },
      {
        "id": "totals-match",
        "name": "Totals Match Check",
        "sampleRate": 1,
        "passRate": 0.97,
        "threshold": 0.95
      },
      {
        "id": "schema-valid",
        "name": "Schema Validator",
        "sampleRate": 1,
        "passRate": 0.995,
        "threshold": 0.98
      }
    ],
    "attention": {
      "unit": "documentType",
      "label": "Document types",
      "values": [
        [
          "invoice",
          0.62
        ],
        [
          "receipt",
          0.17
        ],
        [
          "credit note",
          0.12
        ],
        [
          "delivery note",
          0.09
        ]
      ]
    },
    "outcomes": {
      "resolved": 0.78,
      "misunderstood": 0.02,
      "capability_gap": 0.01,
      "refusal": 0.01,
      "handover": 0.18
    },
    "failureReasons": [
      [
        "Field mapped to the wrong column",
        "misunderstood",
        1
      ],
      [
        "Layout not supported",
        "capability_gap",
        1
      ],
      [
        "Scan unreadable",
        "refusal",
        1
      ],
      [
        "Totals do not match, sent to review",
        "handover",
        0.6
      ],
      [
        "Low confidence field, sent to review",
        "handover",
        0.4
      ]
    ],
    "guardrails": [],
    "fields": [
      [
        "supplier",
        0.975
      ],
      [
        "invoice_number",
        0.985
      ],
      [
        "invoice_date",
        0.97
      ],
      [
        "total",
        0.955
      ],
      [
        "vat",
        0.935
      ],
      [
        "line_items",
        0.885
      ],
      [
        "po_number",
        0.92
      ]
    ],
    "reviewShare": 0.18,
    "thumbsUp": 0.9,
    "loopShare": 0.002,
    "retryShare": 0.03,
    "vocab": {
      "names": [
        "extract_invoice",
        "extract_receipt",
        "extract_credit_note",
        "extract_delivery_note",
        "validate_totals"
      ],
      "namesByTopic": {
        "invoice": "extract_invoice",
        "receipt": "extract_receipt",
        "credit note": "extract_credit_note",
        "delivery note": "extract_delivery_note"
      },
      "tools": [
        "ocr_pages",
        "classify_document",
        "extract_fields",
        "match_supplier",
        "validate_totals",
        "post_to_erp"
      ],
      "previews": [
        [
          "invoice_2026_08_0412.pdf (3 pages)",
          "Supplier Brightline GmbH, invoice 0412, 14 line items, total 18,240.50 EUR, VAT 19%. Totals match. Posted."
        ],
        [
          "credit_note_77.pdf (1 page)",
          "Credit note 77 from Harbor Supplies, total 1,120.00 EUR. Sign missing and no link to the original invoice. Sent to review."
        ],
        [
          "scan_0091.jpg (1 page)",
          "Receipt from Metro Office, total 86.40 EUR. Low scan quality on the VAT line, sent to review."
        ],
        [
          "invoice_INV-55821.pdf (2 pages)",
          "Supplier Northpoint Logistics, 6 line items, total 4,980.00 EUR. PO 7731 matched. Posted."
        ],
        [
          "delivery_note_DN-2208.pdf (1 page)",
          "Delivery note DN-2208 from Kestrel Paper, 3 items, matched to PO 7710. Posted."
        ]
      ],
      "previewsByReason": {
        "invoice|Field mapped to the wrong column": [
          [
            "invoice_2026_08_0457.pdf (2 pages)",
            "Invoice 0457 from Brightline GmbH. VAT amount written into the net total field. Posted with a field error."
          ],
          [
            "invoice_INV-56114.pdf (3 pages)",
            "Invoice INV-56114 from Northpoint Logistics. VAT amount written into the net total field. Posted with a field error."
          ],
          [
            "invoice_A-3390.pdf (1 page)",
            "Invoice A-3390 from Fenwick Tools. VAT amount written into the net total field. Posted with a field error."
          ]
        ],
        "invoice|Layout not supported": [
          [
            "invoice_2026_08_0457.pdf (2 pages)",
            "Invoice 0457 from Brightline GmbH. Layout not recognised, sent to review."
          ],
          [
            "invoice_INV-56114.pdf (3 pages)",
            "Invoice INV-56114 from Northpoint Logistics. Layout not recognised, sent to review."
          ],
          [
            "invoice_A-3390.pdf (1 page)",
            "Invoice A-3390 from Fenwick Tools. Layout not recognised, sent to review."
          ]
        ],
        "invoice|Scan unreadable": [
          [
            "invoice_2026_08_0457.pdf (2 pages)",
            "Invoice 0457 from Brightline GmbH. Scan too blurry to read. Sent back to the uploader."
          ],
          [
            "invoice_INV-56114.pdf (3 pages)",
            "Invoice INV-56114 from Northpoint Logistics. Scan too blurry to read. Sent back to the uploader."
          ],
          [
            "invoice_A-3390.pdf (1 page)",
            "Invoice A-3390 from Fenwick Tools. Scan too blurry to read. Sent back to the uploader."
          ]
        ],
        "invoice|Totals do not match, sent to review": [
          [
            "invoice_2026_08_0457.pdf (2 pages)",
            "Invoice 0457 from Brightline GmbH. Line items and header total differ. Sent to review."
          ],
          [
            "invoice_INV-56114.pdf (3 pages)",
            "Invoice INV-56114 from Northpoint Logistics. Line items and header total differ. Sent to review."
          ],
          [
            "invoice_A-3390.pdf (1 page)",
            "Invoice A-3390 from Fenwick Tools. Line items and header total differ. Sent to review."
          ]
        ],
        "invoice|Low confidence field, sent to review": [
          [
            "invoice_2026_08_0457.pdf (2 pages)",
            "Invoice 0457 from Brightline GmbH. Supplier IBAN read with low confidence. Sent to review."
          ],
          [
            "invoice_INV-56114.pdf (3 pages)",
            "Invoice INV-56114 from Northpoint Logistics. Supplier IBAN read with low confidence. Sent to review."
          ],
          [
            "invoice_A-3390.pdf (1 page)",
            "Invoice A-3390 from Fenwick Tools. Supplier IBAN read with low confidence. Sent to review."
          ]
        ],
        "receipt|Field mapped to the wrong column": [
          [
            "receipt_RC-1219.jpg (1 page)",
            "Receipt from Metro Office. VAT amount written into the net total field. Posted with a field error."
          ],
          [
            "receipt_fuel_0802.jpg (1 page)",
            "Fuel receipt from Ridgeway Services. VAT amount written into the net total field. Posted with a field error."
          ]
        ],
        "receipt|Layout not supported": [
          [
            "receipt_RC-1219.jpg (1 page)",
            "Receipt from Metro Office. Layout not recognised, sent to review."
          ],
          [
            "receipt_fuel_0802.jpg (1 page)",
            "Fuel receipt from Ridgeway Services. Layout not recognised, sent to review."
          ]
        ],
        "receipt|Scan unreadable": [
          [
            "receipt_RC-1219.jpg (1 page)",
            "Receipt from Metro Office. Scan too blurry to read. Sent back to the uploader."
          ],
          [
            "receipt_fuel_0802.jpg (1 page)",
            "Fuel receipt from Ridgeway Services. Scan too blurry to read. Sent back to the uploader."
          ]
        ],
        "receipt|Totals do not match, sent to review": [
          [
            "receipt_RC-1219.jpg (1 page)",
            "Receipt from Metro Office. Line items and header total differ. Sent to review."
          ],
          [
            "receipt_fuel_0802.jpg (1 page)",
            "Fuel receipt from Ridgeway Services. Line items and header total differ. Sent to review."
          ]
        ],
        "receipt|Low confidence field, sent to review": [
          [
            "receipt_RC-1219.jpg (1 page)",
            "Receipt from Metro Office. Supplier IBAN read with low confidence. Sent to review."
          ],
          [
            "receipt_fuel_0802.jpg (1 page)",
            "Fuel receipt from Ridgeway Services. Supplier IBAN read with low confidence. Sent to review."
          ]
        ],
        "credit note|Field mapped to the wrong column": [
          [
            "credit_note_CN-211.pdf (1 page)",
            "Credit note CN-211 from Harbor Supplies. Total read without its minus sign. Posted with a field error."
          ],
          [
            "credit_note_CN-0098.pdf (1 page)",
            "Credit note CN-0098 from Brightline GmbH. Total read without its minus sign. Posted with a field error."
          ],
          [
            "credit_memo_4471.pdf (2 pages)",
            "Credit memo 4471 from Fenwick Tools. Total read without its minus sign. Posted with a field error."
          ]
        ],
        "credit note|Layout not supported": [
          [
            "credit_note_CN-211.pdf (1 page)",
            "Credit note CN-211 from Harbor Supplies. Layout not recognised, sent to review."
          ],
          [
            "credit_note_CN-0098.pdf (1 page)",
            "Credit note CN-0098 from Brightline GmbH. Layout not recognised, sent to review."
          ],
          [
            "credit_memo_4471.pdf (2 pages)",
            "Credit memo 4471 from Fenwick Tools. Layout not recognised, sent to review."
          ]
        ],
        "credit note|Scan unreadable": [
          [
            "credit_note_CN-211.pdf (1 page)",
            "Credit note CN-211 from Harbor Supplies. Scan too blurry to read. Sent back to the uploader."
          ],
          [
            "credit_note_CN-0098.pdf (1 page)",
            "Credit note CN-0098 from Brightline GmbH. Scan too blurry to read. Sent back to the uploader."
          ],
          [
            "credit_memo_4471.pdf (2 pages)",
            "Credit memo 4471 from Fenwick Tools. Scan too blurry to read. Sent back to the uploader."
          ]
        ],
        "credit note|Totals do not match, sent to review": [
          [
            "credit_note_CN-211.pdf (1 page)",
            "Credit note CN-211 from Harbor Supplies. Sign missing and no link to the original invoice. Sent to review."
          ],
          [
            "credit_note_CN-0098.pdf (1 page)",
            "Credit note CN-0098 from Brightline GmbH. Sign missing and no link to the original invoice. Sent to review."
          ],
          [
            "credit_memo_4471.pdf (2 pages)",
            "Credit memo 4471 from Fenwick Tools. Sign missing and no link to the original invoice. Sent to review."
          ]
        ],
        "credit note|Low confidence field, sent to review": [
          [
            "credit_note_CN-211.pdf (1 page)",
            "Credit note CN-211 from Harbor Supplies. Original invoice number read with low confidence. Sent to review."
          ],
          [
            "credit_note_CN-0098.pdf (1 page)",
            "Credit note CN-0098 from Brightline GmbH. Original invoice number read with low confidence. Sent to review."
          ],
          [
            "credit_memo_4471.pdf (2 pages)",
            "Credit memo 4471 from Fenwick Tools. Original invoice number read with low confidence. Sent to review."
          ]
        ],
        "delivery note|Field mapped to the wrong column": [
          [
            "delivery_note_DN-2231.pdf (1 page)",
            "Delivery note DN-2231 from Kestrel Paper. PO number written into the delivery number field. Posted with a field error."
          ],
          [
            "packing_slip_PS-880.pdf (1 page)",
            "Packing slip PS-880 from Northpoint Logistics. PO number written into the delivery number field. Posted with a field error."
          ]
        ],
        "delivery note|Layout not supported": [
          [
            "delivery_note_DN-2231.pdf (1 page)",
            "Delivery note DN-2231 from Kestrel Paper. Layout not recognised, sent to review."
          ],
          [
            "packing_slip_PS-880.pdf (1 page)",
            "Packing slip PS-880 from Northpoint Logistics. Layout not recognised, sent to review."
          ]
        ],
        "delivery note|Scan unreadable": [
          [
            "delivery_note_DN-2231.pdf (1 page)",
            "Delivery note DN-2231 from Kestrel Paper. Scan too blurry to read. Sent back to the uploader."
          ],
          [
            "packing_slip_PS-880.pdf (1 page)",
            "Packing slip PS-880 from Northpoint Logistics. Scan too blurry to read. Sent back to the uploader."
          ]
        ],
        "delivery note|Totals do not match, sent to review": [
          [
            "delivery_note_DN-2231.pdf (1 page)",
            "Delivery note DN-2231 from Kestrel Paper. Quantities differ from the PO lines. Sent to review."
          ],
          [
            "packing_slip_PS-880.pdf (1 page)",
            "Packing slip PS-880 from Northpoint Logistics. Quantities differ from the PO lines. Sent to review."
          ]
        ],
        "delivery note|Low confidence field, sent to review": [
          [
            "delivery_note_DN-2231.pdf (1 page)",
            "Delivery note DN-2231 from Kestrel Paper. PO number read with low confidence. Sent to review."
          ],
          [
            "packing_slip_PS-880.pdf (1 page)",
            "Packing slip PS-880 from Northpoint Logistics. PO number read with low confidence. Sent to review."
          ]
        ],
        "Field mapped to the wrong column": [
          [
            "invoice_2026_07_0388.pdf (2 pages)",
            "Supplier Brightline GmbH, total 7,410.00 EUR. VAT amount written into the net total field. Posted with a field error."
          ],
          [
            "receipt_RC-1182.jpg (1 page)",
            "Receipt from Metro Office, the date was read as the receipt number. Posted with a field error."
          ]
        ],
        "Layout not supported": [
          [
            "statement_Q2_harbor.pdf (6 pages)",
            "A supplier statement, not an invoice. Layout not supported, sent to review."
          ]
        ],
        "Scan unreadable": [
          [
            "scan_0091.jpg (1 page)",
            "Scan too blurry to read the totals. Sent back to the uploader."
          ]
        ],
        "Totals do not match, sent to review": [
          [
            "credit_note_77.pdf (1 page)",
            "Credit note 77 from Harbor Supplies, total 1,120.00 EUR. Sign missing and no link to the original invoice. Sent to review."
          ],
          [
            "invoice_INV-56002.pdf (3 pages)",
            "Line items add up to 3,904.20 EUR, header total 3,940.20 EUR. Totals do not match, sent to review."
          ]
        ],
        "Low confidence field, sent to review": [
          [
            "invoice_2026_08_0431.pdf (1 page)",
            "Supplier Kestrel Paper, IBAN read with low confidence. Sent to review."
          ],
          [
            "credit_note_CN-204.pdf (1 page)",
            "Credit note CN-204, original invoice number read with low confidence. Sent to review."
          ]
        ]
      },
      "previewsByTopic": {
        "invoice": [
          [
            "invoice_2026_08_0412.pdf (3 pages)",
            "Supplier Brightline GmbH, invoice 0412, 14 line items, total 18,240.50 EUR, VAT 19%. Totals match. Posted."
          ],
          [
            "invoice_INV-55821.pdf (2 pages)",
            "Supplier Northpoint Logistics, 6 line items, total 4,980.00 EUR. PO 7731 matched. Posted."
          ]
        ],
        "receipt": [
          [
            "receipt_RC-1204.jpg (1 page)",
            "Receipt from Metro Office, total 86.40 EUR, VAT 19%. Posted."
          ]
        ],
        "credit note": [
          [
            "credit_note_CN-198.pdf (1 page)",
            "Credit note CN-198 from Harbor Supplies, total -640.00 EUR, linked to invoice 0377. Posted."
          ]
        ],
        "delivery note": [
          [
            "delivery_note_DN-2208.pdf (1 page)",
            "Delivery note DN-2208 from Kestrel Paper, 3 items, matched to PO 7710. Posted."
          ]
        ]
      },
      "errorTypes": [
        [
          "validation",
          0.45
        ],
        [
          "ocr_failure",
          0.3
        ],
        [
          "timeout",
          0.25
        ]
      ],
      "topics": [
        [
          "invoice",
          0.62
        ],
        [
          "receipt",
          0.17
        ],
        [
          "credit note",
          0.12
        ],
        [
          "delivery note",
          0.09
        ]
      ],
      "newTopics": [
        [
          "purchase order",
          0.06,
          68
        ]
      ],
      "cannotDo": {
        "invoice": [
          [
            "Handwritten invoice, scanned sideways",
            "Handwritten layouts aren't supported."
          ]
        ],
        "receipt": [
          [
            "Thermal receipt photo, faded",
            "This receipt layout isn't supported."
          ]
        ],
        "credit note": [
          [
            "Credit note in Polish",
            "Polish credit notes aren't supported."
          ]
        ],
        "delivery note": [
          [
            "Delivery note with a table across two pages",
            "Multi-page tables aren't supported."
          ]
        ],
        "purchase order": [
          [
            "Purchase order PDF from a new supplier",
            "Purchase orders aren't a supported document type yet."
          ]
        ]
      },
      "inRatio": 0.9
    },
    "changes": [
      {
        "day": 68,
        "kind": "model",
        "label": "Model gpt-5 to claude-sonnet-4.5",
        "effect": {
          "models": [
            [
              "claude-sonnet-4.5",
              0.95
            ],
            [
              "gpt-5",
              0.05
            ]
          ],
          "segments": {
            "credit note": -0.06
          },
          "fields": {
            "credit note:*": -0.06
          },
          "evals": {
            "field-accuracy": -0.007
          }
        }
      },
      {
        "day": 76,
        "kind": "config",
        "label": "Deploy tag auto-post-rules-2",
        "version": "auto-post-rules-2",
        "effect": {
          "outcome": {
            "handover": -0.06,
            "resolved": 0.06
          },
          "reviewShare": -0.06
        }
      }
    ]
  },
  {
    "archetype": "regulated",
    "prototypeOrg": "Northwind Bank",
    "id": "service-bot",
    "description": "Customer service bot for cards, payments and account questions, in pilot with 5% of app users",
    "traffic": {
      "reqPerDay": 700,
      "tokPerReq": 2800,
      "models": [
        [
          "claude-sonnet-4.5",
          1
        ]
      ],
      "errRate": 0.01,
      "p95Ms": 3000
    },
    "coverage": {
      "cost": 1,
      "model": 1,
      "user_id": 0.95,
      "thread_id": 1,
      "customer_id": 0,
      "labels": 0.5,
      "prompt_id": 1,
      "outcome": 0.6,
      "feedback": 0.08,
      "guardrail": 1,
      "language": 0,
      "ttft": 0
    },
    "evaluators": [
      {
        "id": "accuracy",
        "name": "Policy Accuracy Judge",
        "sampleRate": 0.3,
        "passRate": 0.9,
        "threshold": 0.9
      },
      {
        "id": "completeness",
        "name": "Completeness Judge",
        "sampleRate": 0.3,
        "passRate": 0.9,
        "threshold": 0.85
      },
      {
        "id": "inappropriate",
        "name": "Inappropriate Content Judge",
        "sampleRate": 1,
        "passRate": 0.997,
        "threshold": 0.995
      },
      {
        "id": "pii-guard",
        "name": "PII Guardrail",
        "sampleRate": 1,
        "passRate": 0.985,
        "threshold": 0.98
      }
    ],
    "attention": {
      "unit": "team",
      "label": "Teams",
      "values": [
        [
          "Cards",
          0.36
        ],
        [
          "Payments",
          0.3
        ],
        [
          "Accounts",
          0.2
        ],
        [
          "Complaints",
          0.14
        ]
      ]
    },
    "outcomes": {
      "resolved": 0.7455073789320885,
      "misunderstood": 0.05449262106791139,
      "capability_gap": 0.07,
      "refusal": 0.04,
      "handover": 0.09
    },
    "failureReasons": [
      [
        "Ambiguous question",
        "misunderstood",
        1
      ],
      [
        "Policy not in the library",
        "capability_gap",
        1
      ],
      [
        "No citation found, declined to answer",
        "refusal",
        0.7
      ],
      [
        "Blocked by a control",
        "refusal",
        0.3
      ],
      [
        "Needs an advisor",
        "handover",
        1
      ]
    ],
    "guardrails": [
      {
        "id": "pii",
        "name": "PII Guardrail",
        "coverage": 1,
        "blockRate": 0.006,
        "flagRate": 0.001
      },
      {
        "id": "injection",
        "name": "Prompt injection",
        "coverage": 1,
        "blockRate": 0.0012,
        "flagRate": 0.002
      },
      {
        "id": "advice",
        "name": "Financial advice policy",
        "coverage": 1,
        "blockRate": 0.0015,
        "flagRate": 0.008
      }
    ],
    "thumbsUp": 0.86,
    "loopShare": 0.004,
    "retryShare": 0.02,
    "vocab": {
      "names": [
        "service_turn",
        "card_block",
        "payment_status",
        "handover"
      ],
      "tools": [
        "account_lookup",
        "block_card",
        "payment_trace",
        "handover_to_agent"
      ],
      "previews": [
        [
          "I lost my card, block it please.",
          "Your card ending 2291 is blocked. A replacement will arrive in 3 to 5 business days at your registered address."
        ],
        [
          "Why was my transfer to Spain not sent?",
          "The transfer is held for a routine check because it is your first payment to this account. It will be released or explained within one business day."
        ],
        [
          "What is my credit card limit?",
          "I cannot show account details in this chat without verification. Please sign in to the app, where your limit is under Cards."
        ],
        [
          "My card number is 4929 1234 5678 9012, why was it declined?",
          "[blocked by PII Guardrail] Please do not share your full card number here. I can check the decline once you are signed in."
        ],
        [
          "I want to complain about a fee.",
          "I am sorry about the fee. I am passing you to a colleague who can review it and log a complaint if needed."
        ]
      ],
      "previewsByReason": {
        "Ambiguous question": [
          [
            "Why is it so high?",
            "Could you tell me which amount you mean: a fee, a card limit or a payment?"
          ],
          [
            "Is it blocked?",
            "Do you mean your card, a payment or your online banking access?"
          ]
        ],
        "Policy not in the library": [
          [
            "Do you cover phone insurance with the gold card?",
            "I could not find that in our product documents, so I will not guess. A colleague can confirm it."
          ]
        ],
        "No citation found, declined to answer": [
          [
            "What is the fee for a foreign cash withdrawal?",
            "I could not find a source for that fee above the retrieval floor, so I will not answer. A colleague can confirm it."
          ]
        ],
        "Blocked by a control": [
          [
            "My card number is 4929 1234 5678 9012, why was it declined?",
            "[blocked by PII Guardrail] Please do not share your full card number here. I can check the decline once you are signed in."
          ],
          [
            "Should I put my savings in crypto?",
            "[blocked by Advice Guardrail] I cannot give investment advice. An advisor can talk through your options."
          ]
        ],
        "Needs an advisor": [
          [
            "I want to complain about a fee.",
            "I am sorry about the fee. I am passing you to a colleague who can review it and log a complaint if needed."
          ],
          [
            "I cannot pay my loan this month",
            "I am passing you to a colleague in our support team who can discuss payment options with you."
          ]
        ]
      },
      "previewsByTopic": {
        "cards": [
          [
            "I lost my card, block it please.",
            "Your card ending 2291 is blocked. A replacement will arrive in 3 to 5 business days."
          ],
          [
            "How do I activate my new card?",
            "Make a chip and PIN payment or a cash withdrawal, or activate it in the app under Cards."
          ]
        ],
        "payments": [
          [
            "Why was my transfer to Spain not sent?",
            "The transfer is held for a routine check because it is your first payment to this account. It will be released or explained within one business day."
          ],
          [
            "How long does an international payment take?",
            "Payments within the EU arrive the next business day; elsewhere 2 to 4 business days."
          ]
        ],
        "fees": [
          [
            "Is there a fee for paying in euros?",
            "Card payments in euros have no fee. Other currencies have a 1.5% exchange fee."
          ]
        ],
        "account access": [
          [
            "What is my credit card limit?",
            "I cannot show account details without verification. Please sign in to the app, where your limit is under Cards."
          ],
          [
            "I forgot my online banking password",
            "Use Forgot password on the sign-in page; you will need your card and the app to confirm."
          ]
        ]
      },
      "errorTypes": [
        [
          "tool_error",
          0.4
        ],
        [
          "timeout",
          0.3
        ],
        [
          "guardrail_block",
          0.3
        ]
      ],
      "topics": [
        [
          "cards",
          0.35
        ],
        [
          "payments",
          0.3
        ],
        [
          "fees",
          0.15
        ],
        [
          "account access",
          0.2
        ]
      ],
      "newTopics": [
        [
          "travel notice",
          0.06,
          68
        ]
      ],
      "cannotDo": {
        "cards": [
          [
            "Raise my card limit to 10,000",
            "I can't change card limits. Your adviser can."
          ]
        ],
        "payments": [
          [
            "Cancel the transfer I sent an hour ago",
            "I can't recall sent transfers."
          ]
        ],
        "fees": [
          [
            "Refund the overdraft fee from March",
            "I can't refund fees."
          ]
        ],
        "account access": [
          [
            "Unlock my online banking",
            "I can't unlock access here. Please call the number on your card."
          ]
        ],
        "travel notice": [
          [
            "I'm going to Japan next week, tell the bank",
            "I can't add travel notices yet."
          ]
        ]
      },
      "inRatio": 0.7
    },
    "changes": [
      {
        "day": 70,
        "kind": "evaluator",
        "label": "Policy Accuracy Judge prompt v3",
        "version": "judge-v3",
        "effect": {
          "evals": {
            "accuracy": 0.03
          },
          "kappa": {
            "accuracy": -0.14
          }
        }
      },
      {
        "day": 84,
        "kind": "prompt",
        "label": "service-bot prompt rc-3",
        "version": "rc-3"
      }
    ]
  },
  {
    "archetype": "tools-agent",
    "prototypeOrg": "ACME",
    "id": "checkout-agent",
    "description": "Payment & checkout assistant in the storefront",
    "traffic": {
      "reqPerDay": 2600,
      "tokPerReq": 3000,
      "models": [
        [
          "claude-sonnet-4.5",
          0.85
        ],
        [
          "gpt-5-mini",
          0.15
        ]
      ],
      "errRate": 0.011,
      "p95Ms": 2400
    },
    "coverage": {
      "cost": 1,
      "model": 1,
      "user_id": 0.62,
      "thread_id": 0.81,
      "customer_id": 0,
      "labels": 0.35,
      "prompt_id": 0.94,
      "outcome": 0,
      "feedback": 0.04,
      "guardrail": 0.2,
      "language": 0,
      "ttft": 0
    },
    "evaluators": [
      {
        "id": "pii-leak",
        "name": "PII Leak Judge",
        "sampleRate": 0.2,
        "passRate": 0.985,
        "threshold": 0.97
      },
      {
        "id": "faithfulness",
        "name": "Faithfulness Judge",
        "sampleRate": 0.1,
        "passRate": 0.9,
        "threshold": 0.85
      }
    ],
    "attention": {
      "unit": "flow",
      "label": "Flows",
      "values": [
        [
          "POST /checkout/complete",
          1.1126911403611301
        ],
        [
          "apply_discount",
          0.4573225949330035
        ],
        [
          "resolve_cart",
          0.4613372366247209
        ],
        [
          "payment_retry",
          0.2721480896364882
        ],
        [
          "refund_request",
          0.2228626121101948
        ]
      ]
    },
    "outcomes": {
      "resolved": 0.700426804665476,
      "misunderstood": 0.09957319533452391,
      "capability_gap": 0.07,
      "refusal": 0.04,
      "handover": 0.09
    },
    "failureReasons": [
      [
        "Picked the wrong tool",
        "misunderstood",
        0.6
      ],
      [
        "Misread the request",
        "misunderstood",
        0.4
      ],
      [
        "Action not supported",
        "capability_gap",
        1
      ],
      [
        "Refused a valid request",
        "refusal",
        1
      ],
      [
        "Payment step escalated",
        "handover",
        0.55
      ],
      [
        "User asked for a person",
        "handover",
        0.45
      ]
    ],
    "guardrails": [
      {
        "id": "pii",
        "name": "PII",
        "coverage": 0.2,
        "blockRate": 0.004,
        "flagRate": 0.006
      },
      {
        "id": "injection",
        "name": "Prompt injection",
        "coverage": 0.2,
        "blockRate": 0.0015,
        "flagRate": 0.002
      },
      {
        "id": "policy",
        "name": "Content policy",
        "coverage": 0.2,
        "blockRate": 0.0008,
        "flagRate": 0.009
      }
    ],
    "thumbsUp": 0.88,
    "loopShare": 0.012,
    "retryShare": 0.035,
    "vocab": {
      "names": [
        "POST /checkout/complete",
        "apply_discount",
        "resolve_cart",
        "payment_retry",
        "refund_request"
      ],
      "tools": [
        "check_inventory",
        "charge_card",
        "apply_discount",
        "lookup_order"
      ],
      "previews": [
        [
          "I was charged twice for order #18443, can you fix it?",
          "I found two captures for order #18443, one succeeded and one was a retried authorization. I issued a refund for the duplicate ($64.90) and flagged the retry path."
        ],
        [
          "Apply the SUMMER20 code to my cart, it says invalid",
          "SUMMER20 expired on Jul 15. I applied the current promo FALL15 instead: new total $84.15, saving you $14.85."
        ],
        [
          "Where is my refund for the cancelled subscription?",
          "The refund of $29.00 was issued on Jul 28 and typically lands in 3 to 5 business days. Reference rf_9f21."
        ],
        [
          "The total comes out wrong when I add gift wrapping",
          "Gift wrapping was being taxed twice. Corrected total: $1,247.83 including 8.5% sales tax and $12.99 standard shipping."
        ],
        [
          "Can I split payment between two cards?",
          "Done: $200.00 on the Visa ending 4242 and the remaining $86.44 on the Mastercard ending 8210."
        ]
      ],
      "errorTypes": [
        [
          "timeout",
          0.5
        ],
        [
          "tool_error",
          0.25
        ],
        [
          "rate_limit",
          0.15
        ],
        [
          "validation",
          0.1
        ]
      ],
      "topics": [
        [
          "double charge",
          0.24
        ],
        [
          "discount codes",
          0.22
        ],
        [
          "refunds",
          0.2
        ],
        [
          "split payment",
          0.12
        ],
        [
          "shipping cost",
          0.22
        ]
      ],
      "newTopics": [
        [
          "buy now pay later",
          0.08,
          66
        ]
      ],
      "cannotDo": {
        "double charge": [
          [
            "Can you reverse the second charge right now?",
            "I can't reverse charges myself. I've flagged the duplicate for the payments team."
          ]
        ],
        "discount codes": [
          [
            "Can you make me a new discount code for my order?",
            "I can't create discount codes. The codes that work today are listed on the offers page."
          ]
        ],
        "refunds": [
          [
            "Refund it to a different card please",
            "I can only refund to the card used for the order."
          ]
        ],
        "split payment": [
          [
            "Split this between my card and PayPal",
            "Paying with two methods isn't supported at checkout yet."
          ]
        ],
        "shipping cost": [
          [
            "Can you waive shipping if I order two more?",
            "I can't change shipping prices. Free shipping starts at the threshold shown in your cart."
          ]
        ],
        "buy now pay later": [
          [
            "Can I pay in 3 instalments with Klarna?",
            "Pay later options aren't available at checkout yet."
          ]
        ]
      },
      "inRatio": 0.8
    },
    "changes": [
      {
        "day": 84,
        "kind": "prompt",
        "label": "checkout-agent prompt v42",
        "version": "v42"
      },
      {
        "day": 86,
        "kind": "incident",
        "label": "Alert: payment_retry error rate"
      }
    ]
  },
  {
    "archetype": "generative",
    "prototypeOrg": "Contoso Retail",
    "id": "product-copy",
    "description": "Writes product descriptions for new catalogue items",
    "traffic": {
      "reqPerDay": 420,
      "tokPerReq": 3400,
      "models": [
        [
          "gpt-5",
          0.7
        ],
        [
          "gpt-5-mini",
          0.3
        ]
      ],
      "errRate": 0.006,
      "p95Ms": 6800,
      "flat": true
    },
    "coverage": {
      "cost": 1,
      "model": 1,
      "user_id": 1,
      "thread_id": 0,
      "customer_id": 0,
      "labels": 0.6,
      "prompt_id": 0.95,
      "outcome": 0,
      "feedback": 0.92,
      "guardrail": 0.2,
      "language": 1,
      "ttft": 0
    },
    "evaluators": [
      {
        "id": "brand-rules",
        "name": "Brand Rules Check",
        "sampleRate": 1,
        "passRate": 0.93,
        "threshold": 0.9
      },
      {
        "id": "facts-from-input",
        "name": "Facts From Input Judge",
        "sampleRate": 0.25,
        "passRate": 0.88,
        "threshold": 0.85
      }
    ],
    "attention": {
      "unit": "segment",
      "label": "Categories",
      "values": [
        [
          "outerwear",
          0.3
        ],
        [
          "footwear",
          0.25
        ],
        [
          "knitwear",
          0.2
        ],
        [
          "accessories",
          0.25
        ]
      ],
      "names": {
        "outerwear": "Outerwear",
        "footwear": "Footwear",
        "knitwear": "Knitwear",
        "accessories": "Accessories"
      }
    },
    "outcomes": {
      "resolved": 0.71466226471588,
      "misunderstood": 0.06533773528411985,
      "capability_gap": 0.07,
      "refusal": 0.04,
      "handover": 0.09
    },
    "failureReasons": [
      [
        "Off the brief",
        "misunderstood",
        1
      ],
      [
        "Facts missing from the input",
        "capability_gap",
        1
      ],
      [
        "Blocked by a content rule",
        "refusal",
        1
      ],
      [
        "Rewritten by hand",
        "handover",
        1
      ]
    ],
    "guardrails": [
      {
        "id": "pii",
        "name": "PII",
        "coverage": 0.2,
        "blockRate": 0.004,
        "flagRate": 0.006
      },
      {
        "id": "injection",
        "name": "Prompt injection",
        "coverage": 0.2,
        "blockRate": 0.0015,
        "flagRate": 0.002
      },
      {
        "id": "policy",
        "name": "Content policy",
        "coverage": 0.2,
        "blockRate": 0.0008,
        "flagRate": 0.009
      }
    ],
    "generative": {
      "accepted": 0.55,
      "edited": 0.27,
      "regenerated": 0.12,
      "dropped": 0.06
    },
    "segmentShift": {
      "footwear": -0.06,
      "accessories": 0.03
    },
    "thumbsUp": 0.9,
    "loopShare": 0.002,
    "retryShare": 0.03,
    "vocab": {
      "names": [
        "write_description",
        "rewrite_description",
        "write_bullets"
      ],
      "tools": [
        "fetch_item_attributes",
        "brand_rules",
        "draft_copy"
      ],
      "previews": [
        [
          "Item 88120: Harbour parka, navy, recycled shell, down fill",
          "A navy parka for wet harbour mornings: a recycled shell that shrugs off rain and a down fill that keeps the cold out."
        ],
        [
          "Item 88341: Trail runner, grey, size 36 to 47",
          "Light, grippy and ready for gravel: the trail runner in grey, from size 36 to 47."
        ],
        [
          "Item 88402: Merino crew, oat",
          "Soft oat merino in a clean crew neck. Warm without the bulk, easy to layer."
        ],
        [
          "Item 88517: Leather belt, tan, brass buckle",
          "A tan leather belt with a solid brass buckle that only gets better with wear."
        ]
      ],
      "errorTypes": [
        [
          "timeout",
          0.5
        ],
        [
          "validation",
          0.3
        ],
        [
          "rate_limit",
          0.2
        ]
      ],
      "topics": [
        [
          "new items",
          0.6
        ],
        [
          "rewrites",
          0.25
        ],
        [
          "seasonal edits",
          0.15
        ]
      ],
      "newTopics": [
        [
          "bundles",
          0.07,
          70
        ]
      ],
      "cannotDo": {
        "new items": [
          [
            "Write copy for an item with no photos or specs",
            "There aren't enough facts in the input to write it."
          ]
        ],
        "rewrites": [
          [
            "Rewrite this listing in Japanese",
            "Japanese isn't one of the supported languages."
          ]
        ],
        "seasonal edits": [
          [
            "Add the Black Friday price to every listing",
            "I don't have pricing data."
          ]
        ],
        "bundles": [
          [
            "Write one description for this 3-item bundle",
            "Bundles aren't supported as a single product yet."
          ]
        ]
      },
      "inRatio": 0.7
    },
    "changes": [
      {
        "day": 79,
        "kind": "prompt",
        "label": "Prompt v8: shorter bullets, size table first",
        "version": "v8",
        "effect": {
          "evals": {
            "brand-rules": 0.02
          },
          "segments": {
            "footwear": 0.04,
            "knitwear": -0.03
          }
        }
      }
    ]
  }
];
