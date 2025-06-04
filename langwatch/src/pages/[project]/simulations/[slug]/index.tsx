import { useRouter } from "next/router";
import "@copilotkit/react-ui/styles.css";
import "../simulations.css";
import { SimulationSetPage } from "./SimulationSetPage";
import { IndividuatlSetPage } from "./IndividuatlSetPage";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";

// Main layout for a single Simulation Set page
export default function SlugRouter() {
  const { slug } = useSimulationRouter();

  if (slug?.startsWith("batch")) {
    return <SimulationSetPage batchRunId={slug} />;
  }
  if (slug?.startsWith("scenario-run")) {
    return <IndividuatlSetPage scenarioRunId={slug} />;
  }

  return <div>Invalid slug</div>;
}
