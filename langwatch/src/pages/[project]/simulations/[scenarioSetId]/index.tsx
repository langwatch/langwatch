import "@copilotkit/react-ui/styles.css";
import "../simulations.css";
import { SimulationSetPage } from "./[batchRunId]";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";

// Main layout for a single Simulation Set page
export default function SlugRouter() {
  const { scenarioSetId } = useSimulationRouter();

  if (!scenarioSetId) {
    return null;
  }

  return <SimulationSetPage scenarioSetId={scenarioSetId} />;
}
