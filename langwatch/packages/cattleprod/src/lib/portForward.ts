import { spawn, type ChildProcess } from "child_process";

let portForwardProcess: ChildProcess | undefined;

export interface PortForwardConfig {
  service: string;
  localPort: number;
  remotePort: number;
  namespace?: string;
  context?: string;
}

const DEFAULT_CONFIG: PortForwardConfig = {
  service: "svc/db-tunnel",
  localPort: 6378,
  remotePort: 6379,
};

export async function startPortForward(
  config: Partial<PortForwardConfig> = {}
): Promise<number> {
  const { service, localPort, remotePort, namespace, context } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  if (portForwardProcess) {
    return localPort;
  }

  const args = ["port-forward", service, `${localPort}:${remotePort}`];

  if (namespace) {
    args.push("-n", namespace);
  }

  if (context) {
    args.push("--context", context);
  }

  return new Promise((resolve, reject) => {
    console.log(`Starting kubectl port-forward ${service} ${localPort}:${remotePort}...`);

    portForwardProcess = spawn("kubectl", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    let errorOutput = "";

    portForwardProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      // kubectl outputs "Forwarding from 127.0.0.1:6378 -> 6379" when ready
      if (output.includes("Forwarding from") && !started) {
        started = true;
        console.log(`Port forward established on localhost:${localPort}`);
        resolve(localPort);
      }
    });

    portForwardProcess.stderr?.on("data", (data: Buffer) => {
      errorOutput += data.toString();
    });

    portForwardProcess.on("error", (err) => {
      if (!started) {
        reject(new Error(`Failed to start kubectl: ${err.message}`));
      }
    });

    portForwardProcess.on("exit", (code) => {
      if (!started) {
        reject(
          new Error(
            `kubectl port-forward exited with code ${code}: ${errorOutput}`
          )
        );
      } else {
        console.log("Port forward connection closed");
      }
      portForwardProcess = undefined;
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!started) {
        stopPortForward();
        reject(new Error(`Port forward timed out after 10 seconds: ${errorOutput}`));
      }
    }, 10000);
  });
}

export function stopPortForward(): void {
  if (portForwardProcess) {
    portForwardProcess.kill();
    portForwardProcess = undefined;
  }
}

export function isPortForwardRunning(): boolean {
  return portForwardProcess !== undefined;
}
