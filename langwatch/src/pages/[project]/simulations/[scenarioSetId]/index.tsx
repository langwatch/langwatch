import { useRouter } from "next/router";
import "@copilotkit/react-ui/styles.css";
import "../simulations.css";
import { SimulationSetPage } from "./SimulationSetPage";
import { IndividuatlSetPage } from "./IndividuatlSetPage";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";

// Main layout for a single Simulation Set page
export default function SlugRouter() {
  const { scenarioSetId } = useSimulationRouter();

  return <SimulationSetPage scenarioSetId={scenarioSetId} />;
}
