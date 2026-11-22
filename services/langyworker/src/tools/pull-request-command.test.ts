import { describe, expect, it } from "vitest";

import {
  pullRequestBase,
  pullRequestBodyFiles,
  pullRequestCreationIndex,
} from "./pull-request-command.js";

const opens = (command: string) => pullRequestCreationIndex(command) >= 0;

describe("pullRequestCreationIndex", () => {
  /** @scenario "Langy cannot open a pull request through the API that hardcodes the eval questions" */
  describe("when the command is gh pr create", () => {
    it("finds it alone, after a cd and behind env assignments", () => {
      expect(opens("gh pr create --fill")).toBe(true);
      expect(opens("cd repo && gh pr create --title x")).toBe(true);
      expect(opens("GH_TOKEN=x gh pr create --fill")).toBe(true);
      expect(opens("gh pr view 12")).toBe(false);
      expect(opens("echo 'gh pr create'")).toBe(false);
    });
  });

  describe("when the command is gh api", () => {
    it("finds an explicit -X POST to the pulls endpoint", () => {
      expect(
        opens("gh api -X POST repos/acme/agent/pulls -f title=Fix -f head=b -f base=main"),
      ).toBe(true);
      expect(opens("gh api repos/acme/agent/pulls -XPOST --input body.json")).toBe(true);
    });

    it("finds --method POST and --method=POST", () => {
      expect(opens("gh api --method POST /repos/acme/agent/pulls --input body.json")).toBe(true);
      expect(opens("gh api --method=post repos/{owner}/{repo}/pulls --input b.json")).toBe(true);
    });

    it("finds the implicit POST of -f and -F fields", () => {
      expect(opens("gh api repos/acme/agent/pulls -f title=Fix -f head=b -f base=main")).toBe(true);
      expect(opens("gh api repos/acme/agent/pulls -F draft=false -f title=x")).toBe(true);
      expect(opens("gh api repos/acme/agent/pulls --raw-field title=x")).toBe(true);
    });

    it("leaves reads and other endpoints alone", () => {
      expect(opens("gh api repos/acme/agent/pulls")).toBe(false);
      expect(opens("gh api -X GET repos/acme/agent/pulls -f state=open")).toBe(false);
      expect(opens("gh api repos/acme/agent/pulls/12/comments -f body=hi")).toBe(false);
      expect(opens("gh api repos/acme/agent/issues -f title=x")).toBe(false);
    });
  });

  describe("when the command is curl", () => {
    it("finds a POST to the pulls endpoint, explicit or implied by a body", () => {
      expect(
        opens(
          `curl -X POST -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/acme/agent/pulls -d '{"title":"Fix","head":"b","base":"main"}'`,
        ),
      ).toBe(true);
      expect(opens("curl --request POST https://api.github.com/repos/acme/agent/pulls")).toBe(true);
      expect(opens("curl -s https://api.github.com/repos/acme/agent/pulls --data @pr.json")).toBe(
        true,
      );
      expect(
        opens(`curl https://github.acme.dev/api/v3/repos/acme/agent/pulls --json '{"title":"x"}'`),
      ).toBe(true);
    });

    it("leaves a read of the pulls endpoint alone", () => {
      expect(opens("curl -s https://api.github.com/repos/acme/agent/pulls")).toBe(false);
      expect(opens("curl https://api.github.com/repos/acme/agent/pulls/3 -X PATCH -d x")).toBe(
        false,
      );
    });
  });
});

describe("pullRequestBase", () => {
  it("reads the base from a flag, a field or a JSON body", () => {
    expect(pullRequestBase("gh pr create --base develop")).toBe("develop");
    expect(pullRequestBase("gh api repos/a/b/pulls -f head=x -f base=develop")).toBe("develop");
    expect(
      pullRequestBase(`curl https://api.github.com/repos/a/b/pulls -d '{"base": "develop"}'`),
    ).toBe("develop");
  });
});

describe("pullRequestBodyFiles", () => {
  it("lists every file the body is read from", () => {
    expect(pullRequestBodyFiles("gh pr create -F pr.md")).toEqual(["pr.md"]);
    expect(pullRequestBodyFiles("gh pr create --body-file=pr.md")).toEqual(["pr.md"]);
    expect(pullRequestBodyFiles("gh api repos/a/b/pulls -F body=@pr.md -f title=x")).toEqual([
      "pr.md",
    ]);
    expect(pullRequestBodyFiles("gh api repos/a/b/pulls --input pr.json")).toEqual(["pr.json"]);
    expect(pullRequestBodyFiles("curl https://api.github.com/repos/a/b/pulls -d @pr.json")).toEqual(
      ["pr.json"],
    );
  });
});
