import { Instance } from "./instance.ts";
import type { Ksuid } from "./ksuid.ts";
import { getRandomBytes, detectPlatform } from "./platform.ts";
import { checkPrefix, checkInstance, checkNonEmptyString } from "./validation.ts";

// Factory function to create Ksuid instances
export type KsuidFactory = (
  environment: string,
  resource: string,
  timestamp: number,
  instance: Instance,
  sequenceId: number,
) => Ksuid;

export class Node {
  private _environment: string;
  private _instance: Instance;
  private _lastTimestamp = 0;
  private _currentSequence = 0;
  private _ksuidFactory: KsuidFactory;

  constructor(environment = "prod", instance?: Instance, ksuidFactory?: KsuidFactory) {
    this._environment = environment;
    this._instance = instance ?? this.createInstance();
    this._ksuidFactory = ksuidFactory ?? this.defaultKsuidFactory.bind(this);
  }

  get environment(): string {
    return this._environment;
  }

  set environment(value: string) {
    checkPrefix("environment", value);
    this._environment = value;
  }

  get instance(): Instance {
    return this._instance;
  }

  set instance(value: Instance) {
    checkInstance("instance", value);
    this._instance = value;
  }

  generate(resource: string): Ksuid {
    checkNonEmptyString("resource", resource);

    const now = Math.floor(Date.now() / 1000);

    if (this._lastTimestamp === now) {
      this._currentSequence += 1;
    } else {
      this._lastTimestamp = now;
      this._currentSequence = 0;
    }

    return this._ksuidFactory(
      this._environment,
      resource,
      this._lastTimestamp,
      this._instance,
      this._currentSequence,
    );
  }

  private defaultKsuidFactory(
    _environment: string,
    _resource: string,
    _timestamp: number,
    _instance: Instance,
    _sequenceId: number,
  ): Ksuid {
    throw new Error("Ksuid factory not initialized");
  }

  private createInstance(): Instance {
    const platform = detectPlatform();

    if (platform.isBrowser) {
      const buf = getRandomBytes(8);
      return new Instance(Instance.schemes.RANDOM, buf);
    }

    if (platform.isNode) {
      // Try Docker container first
      const dockerInstance = this.getDockerInstance();
      if (dockerInstance) {
        return dockerInstance;
      }

      // Try MAC + PID
      const macPidInstance = this.getMacPidInstance();
      if (macPidInstance) {
        return macPidInstance;
      }

      // Fallback to random
      const buf = getRandomBytes(8);
      return new Instance(Instance.schemes.RANDOM, buf);
    }

    // For Bun, Deno, and other platforms, use random
    const buf = getRandomBytes(8);
    return new Instance(Instance.schemes.RANDOM, buf);
  }

  private getDockerInstance(): Instance | null {
    try {
      const fs = require("fs") as {
        existsSync: (path: string) => boolean;

        readFileSync: (path: string, encoding: string) => string;
      };

      const path = require("path") as {
        basename: (path: string) => string;
      };

      if (!fs.existsSync("/proc/1/cpuset")) {
        return null;
      }

      const src = fs.readFileSync("/proc/1/cpuset", "utf8").trim();

      if (!src.startsWith("/docker")) {
        return null;
      }

      const containerId = path.basename(src);
      if (containerId.length !== 64) {
        return null;
      }

      const bytes = Buffer.from(containerId, "hex");
      if (bytes.length !== 32) {
        return null;
      }

      return new Instance(Instance.schemes.DOCKER_CONT, bytes.slice(0, 8));
    } catch {
      return null;
    }
  }

  private getMacPidInstance(): Instance | null {
    try {
      const os = require("os") as {
        networkInterfaces: () => Record<
          string,
          {
            internal: boolean;
            mac: string;
          }[]
        >;
      };
      const interfaces = Object.values(os.networkInterfaces()).flat() as {
        internal: boolean;
        mac: string;
      }[];

      const int = interfaces.find(
        (i) => !i.internal && i.mac !== "00:00:00:00:00:00" && !i.mac.startsWith("02:42"),
      );

      if (!int) {
        return null;
      }

      const buf = new Uint8Array(8);
      const macBytes = Buffer.from(int.mac.replace(/:/g, ""), "hex");
      buf.set(macBytes.slice(0, 6), 0);

      // Write PID in last 2 bytes
      if (typeof process !== "undefined") {
        const pid = process.pid % 65536;
        buf[6] = (pid >> 8) & 0xff;
        buf[7] = pid & 0xff;
      }

      return new Instance(Instance.schemes.MAC_AND_PID, buf);
    } catch {
      return null;
    }
  }
}
