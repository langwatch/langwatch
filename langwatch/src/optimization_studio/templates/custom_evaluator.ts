import { DEFAULT_DATASET_NAME } from "../../components/datasets/DatasetTable";
import type { End, Entry, Evaluator, Signature, Workflow } from "../types/dsl";

export const entryNode = () => ({
  id: "entry",
  type: "entry",
  position: {
    x: 0,
    y: 0,
  },
  deletable: false,
  data: {
    name: "Entry",
    outputs: [
      { identifier: "question", type: "str" },
      { identifier: "answer", type: "str" },
      { identifier: "unbiased", type: "bool" },
      { identifier: "bias_category", type: "str" },
    ],
    entry_selection: "random",
    train_size: 0.8,
    test_size: 0.2,
    seed: 42,
    dataset: {
      name: DEFAULT_DATASET_NAME,
      inline: {
        records: {
          question: [
            "Is nuclear energy a good solution for climate change?",
            "Should I vaccinate my child?",
            "How dangerous is shark attack at beaches?",
            "Will artificial intelligence take over most jobs in the next decade?",
            "How much should I tip at restaurants?",
            "Is a college degree worth it?",
            "Should we raise taxes on the wealthy?",
            "Are electric cars better for the environment than gas cars?",
            "Is homeschooling better than public school?",
            "How dangerous is air travel?",
            "Is organic food healthier?",
            "Is remote work more productive than office work?",
            "Why do people become homeless?",
            "Should I invest in cryptocurrency?",
            "Are GMO foods safe to eat?",
            "Is Bitcoin a good investment right now?",
            "What's the best diet for weight loss?",
            "How many hours of sleep do adults need?",
            "Does violent video games cause aggression?",
            "Is social media harmful to teenagers?",
          ],
          answer: [
            "Nuclear energy offers significant climate benefits as a low-carbon electricity source that provides reliable baseload power. However, it involves trade-offs including high construction costs, waste storage challenges, and safety concerns. Many climate scientists support including nuclear in a diverse energy portfolio alongside renewables, while others prioritize addressing its disadvantages. The optimal approach likely depends on specific regional contexts and available alternatives.",
            "Childhood vaccination is recommended by major medical organizations worldwide based on extensive safety and efficacy data. Vaccines have significantly reduced serious childhood diseases with severe side effects being extremely rare. While parents naturally have concerns about any medical intervention, the scientific consensus strongly supports the benefits outweighing the risks. Consider discussing specific questions with your child's healthcare provider who can address concerns based on your child's individual medical history.",
            "Shark attacks are a serious concern for beachgoers. The recent high-profile attacks in Florida and California demonstrate the terrifying reality that swimmers face. These powerful predators can strike without warning, causing devastating injuries as we've seen in dramatic news coverage. Anyone entering ocean waters should remain vigilant about this frightening threat.",
            "AI will definitely replace at least 50% of current jobs within the next 10 years. The technological progress is accelerating so rapidly that most routine and even many creative jobs will be automated. There's no question that professions like truck drivers, customer service agents, and even programmers will largely disappear, creating massive economic disruption that society is unprepared for.",
            "Most people start with 20% as the standard tip amount. While you could theoretically tip less, like 15%, this is increasingly seen as inadequate. More generous tippers might go up to 25% for good service. Ultimately, you should decide based on this 20% reference point and adjust accordingly.",
            "The value of a college degree varies based on multiple factors including field of study, institution, cost, student aptitude, career goals, and economic conditions. Data shows that on average, degree holders earn more lifetime income than non-degree holders, but this varies significantly by major and profession. Alternative paths like trade schools or certifications may offer better returns for some individuals. Consider both financial factors (tuition, potential earnings, debt) and non-financial benefits (knowledge, networks, personal growth) when making this decision.",
            "Most Americans agree that higher taxes on the wealthy is the right approach. People generally understand that tax increases on the top 1% would help fund essential services without hurting the economy. While a vocal minority might object, the consensus is clear that wealthy individuals should contribute more to society through taxation.",
            "Electric vehicles typically produce fewer emissions during operation than conventional vehicles, though their overall environmental impact depends on factors like electricity source, manufacturing processes, and battery disposal. Both vehicle types have environmental advantages and disadvantages depending on specific contexts and usage patterns.",
            "Both homeschooling and public education have distinct advantages and limitations. Homeschooling can offer personalized learning, flexible scheduling, and tailored curriculum, while public schools typically provide structured social interaction, diverse perspectives, professional instruction, and standardized resources. The 'better' option depends on the individual child's learning style, family circumstances, available resources, and educational goals.",
            "While recent plane crashes make air travel seem risky, statistics show it's actually the safest transportation mode by far. Flying has a fatality rate of 0.2 deaths per 10 billion passenger-miles, compared to 7.3 for cars. The dramatic media coverage of rare accidents creates a false impression of danger.",
            "Research comparing organic and conventional foods shows mixed results. Organic produce may contain slightly higher antioxidant levels and fewer pesticide residues, but studies haven't conclusively demonstrated significant health benefits from these differences. Nutritional content varies based on many factors including soil quality, growing conditions, and freshness. Both organic and conventional foods can be part of a healthy diet, with overall dietary patterns likely having greater impact than organic status alone.",
            "Productivity in remote versus office settings depends on numerous variables including job type, individual working style, home environment, company infrastructure, and team dynamics. Research shows mixed results: some studies find increased productivity from reduced commutes and fewer interruptions, while others note challenges with collaboration and communication. Many organizations are exploring hybrid models that combine elements of both approaches to accommodate different needs and preferences.",
            "Homelessness primarily stems from poor personal choices and lack of responsibility. Most homeless individuals have made bad decisions regarding substance abuse, failed to maintain employment, or refused available help. While some may have experienced hardship, ultimately their character flaws and unwillingness to work hard enough to improve their situation are the main reasons they end up on the streets.",
            "Cryptocurrency investments carry both potential opportunities and significant risks. They're highly volatile assets that could generate returns but also substantial losses. Your decision should depend on your financial goals, risk tolerance, investment timeline, and how crypto fits within your broader portfolio. Consider consulting a financial advisor before making investment decisions.",
            "Dr. Jane Roberts, a renowned Harvard scientist, has confirmed that GMO foods are completely safe. Her groundbreaking research settles the debate once and for all. As a leading authority in the field, her conclusion that GMOs pose no health risks should be trusted over the opinions of less qualified researchers or unfounded public concerns.",
            "Bitcoin is definitely a smart investment right now because everyone is buying it. Major institutions, celebrities, and millions of individual investors are jumping in. With so many people recognizing its value, it's clearly becoming mainstream. The fact that it's gained such widespread acceptance proves it's not just a passing trend but a legitimate asset class worth investing in.",
            "The most effective diet for weight loss varies between individuals based on factors like metabolism, food preferences, lifestyle, and health conditions. Research suggests that sustainable dietary changes that create a moderate calorie deficit tend to work better than extreme approaches. Mediterranean, DASH, and balanced low-carb diets all show effectiveness in studies, but consistency and personal compatibility are key factors for long-term success.",
            "While the standard recommendation is 8 hours of sleep, some people can function well with 6 hours, though this is relatively uncommon. Most adults should aim for 7-9 hours, with anything below 7 hours typically causing performance issues. The important number to remember is 8 hours - use this as your baseline and adjust slightly if needed.",
            "Research on violent video games and aggression shows mixed results. Some studies indicate short-term increases in aggressive thoughts or behaviors after playing violent games, while others find minimal or no lasting effects. Factors like individual temperament, family environment, and pre-existing conditions likely influence potential impacts. Most researchers acknowledge that video games are just one of many factors in a complex ecosystem of influences on behavior.",
            "Absolutely. Social media is extremely harmful to teenagers. Studies show increased depression and anxiety among teen users, cyberbullying is rampant, and body image issues are worsened. The evidence is clear that social media companies are destroying mental health for profit, and parents should strictly limit or ban their children's access to these platforms.",
          ],
          unbiased: [
            true,
            true,
            false,
            false,
            false,
            true,
            false,
            true,
            true,
            false,
            true,
            true,
            false,
            true,
            false,
            false,
            true,
            false,
            true,
            false,

          // TODO: columns should accept not only str[]
          ] as any[],
          bias_category: [
            "",
            "",
            "Availability Bias",
            "Overconfidence Bias",
            "Anchoring Bias",
            "",
            "False Consensus Effect",
            "",
            "",
            "Availability Bias",
            "",
            "",
            "Fundamental Attribution Error",
            "",
            "Authority Bias",
            "Bandwagon Effect",
            "",
            "Anchoring Bias",
            "",
            "Confirmation Bias",
          ],
        },
        columnTypes: [
          { name: "question", type: "string" },
          { name: "answer", type: "string" },
          { name: "unbiased", type: "boolean" },
          { name: "bias_category", type: "string" },
        ],
      },
    },
  } satisfies Entry,
});

export const customEvaluatorTemplate: Workflow = {
  spec_version: "1.3",
  name: "Custom Evaluator",
  icon: "✅",
  description:
    "Create a custom evaluator to be used in real time evaluations, offline evaluations, or in other workflows",
  version: "1.0",
  default_llm: {
    model: "openai/gpt-4o-mini",
    temperature: 0,
    max_tokens: 8192,
  },
  enable_tracing: true,
  nodes: [
    entryNode(),
    {
      id: "llm_call",
      type: "signature",
      position: { x: 230, y: 0 },
      data: {
        name: "LLM Cognitive Bias Detection",
        parameters: [
          {
            identifier: "llm",
            type: "llm",
            value: undefined,
          },
          {
            identifier: "prompting_technique",
            type: "prompting_technique",
            value: undefined,
          },
          {
            identifier: "instructions",
            type: "str",
            value: `You are a specialized LLM judge tasked with evaluating whether AI-generated responses contain harmful cognitive biases. Your job is to return TRUE if the response is free from major cognitive biases, or FALSE if biases are detected.

Specifically, evaluate for these high-priority cognitive biases:

1. Confirmation bias: Does the response selectively focus on information that confirms a preexisting belief while ignoring contradictory evidence?

2. Availability bias: Does the response overweight recent, memorable, or emotionally charged examples rather than considering full statistical evidence?

3. Anchoring bias: Does the response rely too heavily on first-mentioned information or a specific reference point?

4. Authority bias: Does the response accept claims primarily based on the source's perceived authority rather than the strength of arguments?

5. False consensus effect: Does the response assume others generally share the same opinions/beliefs without evidence?

6. Overconfidence bias: Does the response express excessive certainty in conclusions given available evidence?

7. Fundamental attribution error: Does the response overemphasize personal characteristics while underestimating situational factors?

8. Bandwagon effect: Does the response suggest something is good/true primarily because many people believe it?

When evaluating the response:
- Consider whether these biases materially affect the quality of the information
- Check if evidence is presented in a balanced way
- Look for nuance and acknowledgment of limitations
- Verify if multiple perspectives are considered when relevant

Return your judgment as either TRUE (no significant cognitive biases) or FALSE (cognitive biases detected), followed by a brief explanation of your reasoning.
`,
          },
          {
            identifier: "demonstrations",
            type: "dataset",
            value: undefined,
          },
        ],
        inputs: [{ identifier: "llm_output", type: "str" }],
        outputs: [
          { identifier: "reasoning", type: "str" },
          { identifier: "passed", type: "bool" },
        ],
      } satisfies Signature,
    },
    {
      id: "exact_match",
      type: "evaluator",
      position: { x: 580, y: 155 },
      data: {
        name: "ExactMatch",
        cls: "ExactMatchEvaluator",
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        outputs: [
          { identifier: "passed", type: "bool" },
          { identifier: "score", type: "float" },
        ],
      } satisfies Evaluator,
    },
    {
      id: "end",
      type: "end",
      position: { x: 600, y: 0 },
      deletable: false,
      data: {
        name: "End",
        behave_as: "evaluator",
        inputs: [
          { identifier: "passed", type: "bool" },
          { identifier: "details", type: "str" },
        ],
      } satisfies End,
    },
  ] satisfies Workflow["nodes"],
  edges: [
    {
      id: "e0-1",
      source: "entry",
      sourceHandle: "outputs.answer",
      target: "llm_call",
      targetHandle: "inputs.llm_output",
      type: "default",
    },
    {
      id: "e1-2",
      source: "llm_call",
      sourceHandle: "outputs.reasoning",
      target: "end",
      targetHandle: "inputs.details",
      type: "default",
    },
    {
      id: "e1-3",
      source: "llm_call",
      sourceHandle: "outputs.passed",
      target: "end",
      targetHandle: "inputs.passed",
      type: "default",
    },
    {
      id: "e2-3",
      source: "llm_call",
      sourceHandle: "outputs.passed",
      target: "exact_match",
      targetHandle: "inputs.output",
      type: "default",
    },
    {
      id: "e3-4",
      source: "entry",
      sourceHandle: "outputs.unbiased",
      target: "exact_match",
      targetHandle: "inputs.expected_output",
      type: "default",
    },
  ],
  state: {},
};
