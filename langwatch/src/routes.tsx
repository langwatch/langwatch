import { lazy, Suspense, useEffect, useRef } from "react";
import {
  createBrowserRouter,
  Outlet,
  useLocation,
  type RouteObject,
} from "react-router";
import NProgress from "nprogress";
import { InnerProviders } from "./AppProviders";

/**
 * Root layout — wraps all routes.
 * - InnerProviders: CommandBar, Analytics, PostHog (need Router context)
 * - NProgress: loading bar on navigation
 */
function RootLayout() {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    NProgress.configure({ showSpinner: false });
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    NProgress.start();
    const timeout = setTimeout(() => NProgress.done(), 100);
    return () => {
      clearTimeout(timeout);
      NProgress.done();
    };
  }, [location.pathname]);

  return (
    <InnerProviders>
      <Suspense>
        <Outlet />
      </Suspense>
    </InnerProviders>
  );
}

// Lazy-load all page components
const Index = lazy(() => import("./pages/index"));
const Authorize = lazy(() => import("./pages/authorize"));
const Onboarding = lazy(() => import("./pages/onboarding"));
const OnboardingTeamProject = lazy(
  () => import("./pages/onboarding/[team]/project")
);
const OnboardingProduct = lazy(
  () => import("./pages/onboarding/product/index")
);
const OnboardingWelcome = lazy(
  () => import("./pages/onboarding/welcome")
);
const Settings = lazy(() => import("./pages/settings"));

// Auth
const SignIn = lazy(() => import("./pages/auth/signin"));
const SignUp = lazy(() => import("./pages/auth/signup"));
const AuthError = lazy(() => import("./pages/auth/error"));

// Admin
const Admin = lazy(() => import("./pages/admin/index"));

// Invite
const InviteAccept = lazy(() => import("./pages/invite/accept"));

// MCP
const McpAuthorize = lazy(() => import("./pages/mcp/authorize"));

// Share
const SharePage = lazy(() => import("./pages/share/[id]"));

// Settings sub-pages
const SettingsAccessAudit = lazy(
  () => import("./pages/settings/access-audit")
);
const SettingsAnnotationScores = lazy(
  () => import("./pages/settings/annotation-scores")
);
const SettingsAuditLog = lazy(
  () => import("./pages/settings/audit-log")
);
const SettingsAuthentication = lazy(
  () => import("./pages/settings/authentication")
);
const SettingsGroups = lazy(() => import("./pages/settings/groups"));
const SettingsLicense = lazy(() => import("./pages/settings/license"));
const SettingsMembers = lazy(() => import("./pages/settings/members"));
const SettingsMemberDetail = lazy(
  () => import("./pages/settings/members/[userId]")
);
const SettingsModelCosts = lazy(
  () => import("./pages/settings/model-costs")
);
const SettingsModelProviders = lazy(
  () => import("./pages/settings/model-providers")
);
const SettingsPlans = lazy(() => import("./pages/settings/plans"));
const SettingsRoles = lazy(() => import("./pages/settings/roles"));
const SettingsScim = lazy(() => import("./pages/settings/scim"));
const SettingsSecrets = lazy(() => import("./pages/settings/secrets"));
const SettingsSubscription = lazy(
  () => import("./pages/settings/subscription")
);
const SettingsTeams = lazy(() => import("./pages/settings/teams"));
const SettingsTeamDetail = lazy(
  () => import("./pages/settings/teams/[team]")
);
const SettingsTopicClustering = lazy(
  () => import("./pages/settings/topic-clustering")
);
const SettingsUsage = lazy(() => import("./pages/settings/usage"));

// Project pages
const ProjectIndex = lazy(() => import("./pages/[project]/index"));
const ProjectAgents = lazy(() => import("./pages/[project]/agents"));
const ProjectAutomations = lazy(
  () => import("./pages/[project]/automations")
);
const ProjectDatasets = lazy(
  () => import("./pages/[project]/datasets")
);
const ProjectDatasetDetail = lazy(
  () => import("./pages/[project]/datasets/[id]")
);
const ProjectEvaluators = lazy(
  () => import("./pages/[project]/evaluators")
);
const ProjectEvaluations = lazy(
  () => import("./pages/[project]/evaluations")
);
const ProjectEvaluationsNew = lazy(
  () => import("./pages/[project]/evaluations/new")
);
const ProjectEvaluationsNewChoose = lazy(
  () => import("./pages/[project]/evaluations/new/choose")
);
const ProjectEvaluationsWizard = lazy(
  () => import("./pages/[project]/evaluations/wizard")
);
const ProjectEvaluationsWizardSlug = lazy(
  () => import("./pages/[project]/evaluations/wizard/[slug]")
);
const ProjectEvaluationsEditId = lazy(
  () => import("./pages/[project]/evaluations/[id]/edit")
);
const ProjectEvaluationsEditIdChoose = lazy(
  () => import("./pages/[project]/evaluations/[id]/edit/choose")
);
const ProjectMessages = lazy(
  () => import("./pages/[project]/messages")
);
const ProjectMessageTrace = lazy(
  () => import("./pages/[project]/messages/[trace]/index")
);
const ProjectMessageTraceTab = lazy(
  () => import("./pages/[project]/messages/[trace]/[openTab]/index")
);
const ProjectMessageTraceTabSpan = lazy(
  () => import("./pages/[project]/messages/[trace]/[openTab]/[span]")
);
const ProjectPrompts = lazy(
  () => import("./pages/[project]/prompts")
);
const ProjectSetup = lazy(() => import("./pages/[project]/setup"));
const ProjectWorkflows = lazy(
  () => import("./pages/[project]/workflows")
);
const ProjectChat = lazy(
  () => import("./pages/[project]/chat/[workflow]")
);
const ProjectStudio = lazy(
  () => import("./pages/[project]/studio/[workflow]")
);

// Annotations
const ProjectAnnotations = lazy(
  () => import("./pages/[project]/annotations")
);
const ProjectAnnotationsSlug = lazy(
  () => import("./pages/[project]/annotations/[slug]")
);
const ProjectAnnotationsAll = lazy(
  () => import("./pages/[project]/annotations/all")
);
const ProjectAnnotationsMe = lazy(
  () => import("./pages/[project]/annotations/me")
);
const ProjectAnnotationsMyQueue = lazy(
  () => import("./pages/[project]/annotations/my-queue")
);

// Analytics
const ProjectAnalytics = lazy(
  () => import("./pages/[project]/analytics/index")
);
const ProjectAnalyticsEvaluations = lazy(
  () => import("./pages/[project]/analytics/evaluations")
);
const ProjectAnalyticsMetrics = lazy(
  () => import("./pages/[project]/analytics/metrics")
);
const ProjectAnalyticsReports = lazy(
  () => import("./pages/[project]/analytics/reports")
);
const ProjectAnalyticsTopics = lazy(
  () => import("./pages/[project]/analytics/topics")
);
const ProjectAnalyticsUsers = lazy(
  () => import("./pages/[project]/analytics/users")
);
const ProjectAnalyticsCustom = lazy(
  () => import("./pages/[project]/analytics/custom/index")
);
const ProjectAnalyticsCustomId = lazy(
  () => import("./pages/[project]/analytics/custom/[id]")
);

// Experiments
const ProjectExperiments = lazy(
  () => import("./pages/[project]/experiments/index")
);
const ProjectExperimentsDetail = lazy(
  () => import("./pages/[project]/experiments/[experiment]")
);
const ProjectExperimentsWorkbench = lazy(
  () => import("./pages/[project]/experiments/workbench/index")
);
const ProjectExperimentsWorkbenchSlug = lazy(
  () => import("./pages/[project]/experiments/workbench/[slug]")
);

// Simulations (catch-all)
const ProjectSimulations = lazy(
  () => import("./pages/[project]/simulations/[[...path]]")
);
const ProjectSimulationsScenarios = lazy(
  () => import("./pages/[project]/simulations/scenarios/index")
);

const routes: RouteObject[] = [
  // Auth (public)
  { path: "/auth/signin", Component: SignIn },
  { path: "/auth/signup", Component: SignUp },
  { path: "/auth/error", Component: AuthError },

  // Top-level pages
  { path: "/", Component: Index },
  { path: "/authorize", Component: Authorize },
  { path: "/admin", Component: Admin },
  { path: "/invite/accept", Component: InviteAccept },
  { path: "/mcp/authorize", Component: McpAuthorize },
  { path: "/share/:id", Component: SharePage },

  // Onboarding
  { path: "/onboarding", Component: Onboarding },
  { path: "/onboarding/:team/project", Component: OnboardingTeamProject },
  { path: "/onboarding/product", Component: OnboardingProduct },
  { path: "/onboarding/welcome", Component: OnboardingWelcome },

  // Settings
  { path: "/settings", Component: Settings },
  { path: "/settings/access-audit", Component: SettingsAccessAudit },
  {
    path: "/settings/annotation-scores",
    Component: SettingsAnnotationScores,
  },
  { path: "/settings/audit-log", Component: SettingsAuditLog },
  { path: "/settings/authentication", Component: SettingsAuthentication },
  { path: "/settings/groups", Component: SettingsGroups },
  { path: "/settings/license", Component: SettingsLicense },
  { path: "/settings/members", Component: SettingsMembers },
  { path: "/settings/members/:userId", Component: SettingsMemberDetail },
  { path: "/settings/model-costs", Component: SettingsModelCosts },
  { path: "/settings/model-providers", Component: SettingsModelProviders },
  { path: "/settings/plans", Component: SettingsPlans },
  { path: "/settings/roles", Component: SettingsRoles },
  { path: "/settings/scim", Component: SettingsScim },
  { path: "/settings/secrets", Component: SettingsSecrets },
  { path: "/settings/subscription", Component: SettingsSubscription },
  { path: "/settings/teams", Component: SettingsTeams },
  { path: "/settings/teams/:team", Component: SettingsTeamDetail },
  {
    path: "/settings/topic-clustering",
    Component: SettingsTopicClustering,
  },
  { path: "/settings/usage", Component: SettingsUsage },

  // Project routes
  { path: "/:project", Component: ProjectIndex },
  { path: "/:project/agents", Component: ProjectAgents },
  { path: "/:project/automations", Component: ProjectAutomations },
  { path: "/:project/datasets", Component: ProjectDatasets },
  { path: "/:project/datasets/:id", Component: ProjectDatasetDetail },
  { path: "/:project/evaluators", Component: ProjectEvaluators },
  { path: "/:project/evaluations", Component: ProjectEvaluations },
  { path: "/:project/evaluations/new", Component: ProjectEvaluationsNew },
  {
    path: "/:project/evaluations/new/choose",
    Component: ProjectEvaluationsNewChoose,
  },
  {
    path: "/:project/evaluations/wizard",
    Component: ProjectEvaluationsWizard,
  },
  {
    path: "/:project/evaluations/wizard/:slug",
    Component: ProjectEvaluationsWizardSlug,
  },
  {
    path: "/:project/evaluations/:id/edit",
    Component: ProjectEvaluationsEditId,
  },
  {
    path: "/:project/evaluations/:id/edit/choose",
    Component: ProjectEvaluationsEditIdChoose,
  },
  { path: "/:project/messages", Component: ProjectMessages },
  {
    path: "/:project/messages/:trace",
    Component: ProjectMessageTrace,
  },
  {
    path: "/:project/messages/:trace/:openTab",
    Component: ProjectMessageTraceTab,
  },
  {
    path: "/:project/messages/:trace/:openTab/:span",
    Component: ProjectMessageTraceTabSpan,
  },
  { path: "/:project/prompts", Component: ProjectPrompts },
  { path: "/:project/setup", Component: ProjectSetup },
  { path: "/:project/workflows", Component: ProjectWorkflows },
  { path: "/:project/chat/:workflow", Component: ProjectChat },
  { path: "/:project/studio/:workflow", Component: ProjectStudio },

  // Annotations
  { path: "/:project/annotations", Component: ProjectAnnotations },
  { path: "/:project/annotations/all", Component: ProjectAnnotationsAll },
  { path: "/:project/annotations/me", Component: ProjectAnnotationsMe },
  {
    path: "/:project/annotations/my-queue",
    Component: ProjectAnnotationsMyQueue,
  },
  {
    path: "/:project/annotations/:slug",
    Component: ProjectAnnotationsSlug,
  },

  // Analytics
  { path: "/:project/analytics", Component: ProjectAnalytics },
  {
    path: "/:project/analytics/evaluations",
    Component: ProjectAnalyticsEvaluations,
  },
  {
    path: "/:project/analytics/metrics",
    Component: ProjectAnalyticsMetrics,
  },
  {
    path: "/:project/analytics/reports",
    Component: ProjectAnalyticsReports,
  },
  {
    path: "/:project/analytics/topics",
    Component: ProjectAnalyticsTopics,
  },
  {
    path: "/:project/analytics/users",
    Component: ProjectAnalyticsUsers,
  },
  {
    path: "/:project/analytics/custom",
    Component: ProjectAnalyticsCustom,
  },
  {
    path: "/:project/analytics/custom/:id",
    Component: ProjectAnalyticsCustomId,
  },

  // Experiments
  { path: "/:project/experiments", Component: ProjectExperiments },
  {
    path: "/:project/experiments/workbench",
    Component: ProjectExperimentsWorkbench,
  },
  {
    path: "/:project/experiments/workbench/:slug",
    Component: ProjectExperimentsWorkbenchSlug,
  },
  {
    path: "/:project/experiments/:experiment",
    Component: ProjectExperimentsDetail,
  },

  // Simulations (catch-all)
  {
    path: "/:project/simulations/scenarios",
    Component: ProjectSimulationsScenarios,
  },
  {
    path: "/:project/simulations/*",
    Component: ProjectSimulations,
  },
  {
    path: "/:project/simulations",
    Component: ProjectSimulations,
  },
];

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    children: routes,
  },
]);
