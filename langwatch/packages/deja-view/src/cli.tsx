#!/usr/bin/env node
import "./env-defaults";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { discoverProjections } from "./discovery/projections";
import { discoverEventHandlers } from "./discovery/eventHandlers";
import { buildPipelineAggregateTypeMap } from "./discovery/projections.types";
import { Root } from "./ui/Root";
import type { Environment } from "./io/secrets";

import "dotenv/config";

export interface CliOptions {
  file?: string;
  env: Environment;
  aggregate?: string;
  profile: string;
}

/**
 * CLI entrypoint for the Deja-View debugging tool.
 *
 * @example
 * # File mode
 * deja-view -f ./events.json
 *
 * # Database mode (interactive)
 * deja-view
 *
 * # Database mode (with flags)
 * deja-view --env dev --aggregate trace_abc123 --profile lw-dev
 */
async function main() {
  const program = new Command();
  program
    .name("deja-view")
    .description("LangWatch's Event Sourcing Time Travel Debugger")
    .option("-f, --file <path>", "Path to ClickHouse JSON event log export")
    .option("-e, --env <env>", "Environment (dev, staging, prod)", "dev")
    .option("-a, --aggregate <id>", "Aggregate ID to load")
    .option("-p, --profile <profile>", "AWS profile name", "lw-dev");

  program.parse(process.argv);
  const options = program.opts<CliOptions>();

  // Validate environment
  if (!["dev", "staging", "prod"].includes(options.env)) {
    console.error(`Invalid environment: ${options.env}. Must be dev, staging, or prod.`);
    process.exit(1);
  }

  const [projections, eventHandlers, pipelineAggregateTypes] = await Promise.all([
    discoverProjections(),
    discoverEventHandlers(),
    buildPipelineAggregateTypeMap(),
  ]);

  render(
    <Root
      options={options}
      projections={projections}
      eventHandlers={eventHandlers}
      pipelineAggregateTypes={pipelineAggregateTypes}
    />
  );
}

main().catch((error) => {
  console.error("Failed to start deja-view:", error);
  process.exit(1);
});


