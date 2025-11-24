import { describe } from "vitest";

describe("FormErrorDisplay", () => {
  describe("when error is a ReactNode", () => {
    it.todo("returns the ReactNode directly");
  });

  describe("when error is null or undefined", () => {
    it.todo("returns null");
  });

  describe("when error has valid messages", () => {
    it.todo("processes and returns error messages");
  });

  describe("when error has no valid messages", () => {
    it.todo("returns null");
  });
});

describe("extractErrorMessages", () => {
  describe("when input is not an object or is null/undefined", () => {
    it.todo("returns empty array without processing");
  });

  describe("when input has a valid message property", () => {
    it.todo("adds the message to the result array");
  });

  describe("when input is an array", () => {
    it.todo("processes each array item recursively");
  });

  describe("when input is a plain object without message", () => {
    it.todo("processes each object value recursively");
  });
});
