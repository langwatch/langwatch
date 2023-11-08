import clsx from "clsx";
import Heading from "@theme/Heading";
import styles from "./styles.module.css";
import { BarChart, Bell, Code } from "react-feather";

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<"svg">>;
  description: JSX.Element;
};

const FeatureList: FeatureItem[] = [
  {
    title: "LLMs Tracing and Monitoring",
    Svg: BarChart,
    description: (
      <>
        Track every step of your LLM execution to monitor in real time what is
        being generated and how users are using it
      </>
    ),
  },
  {
    title: "Easy integration with any LLM",
    Svg: Code,
    description: (
      <>
        Integrate with any LLM Model like OpenAI, Anthropic, A21 and so on or
        LLM frameworks like LangChain and Llama Index
      </>
    ),
  },
  {
    title: "Alerts and Debugging",
    Svg: Bell,
    description: (
      <>
        Add automated security and hallucination checks to verify the output of
        your LLM, be alerted and check all traces and prompts to debug on what
        is wrong
      </>
    ),
  },
];

function Feature({ title, Svg, description }: FeatureItem) {
  return (
    <div className={clsx("col col--4")} style={{ paddingTop: "32px" }}>
      <div className="padding-horiz--md" style={{ height: "64px", marginBottom: "8px" }}>
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
