import type { ScenarioService } from "@langwatch/scenario-contract";
import {
  PrismaScenarioAdapter,
  ScenarioClockPort,
  ScenarioIdPort,
  ScenarioSecretCipherPort,
} from "@langwatch/scenario-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SimulationService } from "@langwatch/simulation-contract";
import { decrypt, encrypt } from "~/utils/encryption";

export class AppScenarioRuntime {
  static create(options: {
    database: PrismaClient;
    simulations: SimulationService;
    ids: ScenarioIdPort;
    clock: ScenarioClockPort;
    secretCipher: ScenarioSecretCipherPort;
  }): AppScenarioRuntime {
    return new AppScenarioRuntime(options);
  }

  private constructor(
    private readonly options: {
      database: PrismaClient;
      simulations: SimulationService;
      ids: ScenarioIdPort;
      clock: ScenarioClockPort;
      secretCipher: ScenarioSecretCipherPort;
    },
  ) {}

  build(): ScenarioService {
    return PrismaScenarioAdapter.create({
      prisma: this.options.database,
      simulations: this.options.simulations,
      ids: this.options.ids,
      clock: this.options.clock,
      secretCipher: this.options.secretCipher,
    });
  }
}

export class AppScenarioId extends ScenarioIdPort {
  static create(next: () => string): AppScenarioId {
    return new AppScenarioId(next);
  }

  private constructor(private readonly generate: () => string) {
    super();
  }

  next(): string {
    return this.generate();
  }
}

export class AppScenarioClock extends ScenarioClockPort {
  static create(): AppScenarioClock {
    return new AppScenarioClock();
  }

  private constructor() {
    super();
  }

  now(): Date {
    return new Date();
  }
}

export class AppScenarioSecretCipher extends ScenarioSecretCipherPort {
  encrypt(plaintext: string): string {
    return encrypt(plaintext);
  }

  decrypt(ciphertext: string): string {
    return decrypt(ciphertext);
  }
}
