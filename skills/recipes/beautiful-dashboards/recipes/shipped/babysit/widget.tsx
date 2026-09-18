import { Bars } from "@langwatch/charts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  if (isLoading || data === null) return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  if (data.length === 0) return <div style={{ fontSize: 11, color: "#666" }}>No merged pull requests in this window yet.</div>;

  const rows = data.map((r) => ({ pr: `#${r.pr}`, "before the pull request opened": Number(r.doing), "after (retries, review fixes)": Number(r.babysitting) }));
  return <Bars data={rows} x="pr" series={[{ key: "before the pull request opened" }, { key: "after (retries, review fixes)" }]} stacked format="currency" legend />;
}
